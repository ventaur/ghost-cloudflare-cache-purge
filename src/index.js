export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
}

const DEFAULT_MAX_PAGE_DEPTH = 3 // Default max page depth for listing URLs to purge

// Fields that are typically displayed on post listings and should trigger a purge of the listing URLs.
const listingRelatedFields = [
  'published_at', 'visibility', 
  'title', 'slug', 
  'featured', 'feature_image', 'feature_image_alt', 'feature_image_caption', 
  'custom_excerpt', 'plaintext',
  'authors', 'tags'
]

/**
 * Get a request from Ghost CMS webhook and purge appropriate URLs from cache.
 * 
 * Requests are expected to be in the format of ZONE_ID/ACTION, where ACTION is one of:
 * - postPublished
 * - postUpdated
 * - postUnpublished
 * - pagePublished
 * - pageUpdated
 * - pageUnpublished
 * 
 * The ZONE_ID is the Cloudflare Zone ID for the site.
 * 
 * Additionally, an optional query parameter `?maxPageDepth` can be used to limit the depth of the paged listing URLs to purge.
 * Listing pages include the homepage (unless your theme uses a dedicated homepage with all posts at a different route), tag pages, and author pages.
 * This is useful for sites with a large number of posts, where purging all pages may be unnecessary.
 * The default value is 3, which means only the first and second pages of listings will be purged.
 * If your site uses infinite scroll or has a very large number of posts, you may want to increase this value.
 * Check your analytics to see how many pages are actually being visited.
 *
 * @param {*} request The HTTP request Object
 * @param {*} env The environment variables, where the expected `CF_API_TOKEN` is the Cloudflare API token
 * @returns An HTTP Response
 */
async function handleRequest(request, env) {
  const apiToken = env.CF_API_TOKEN

  const { headers } = request
  const contentType = headers.get('content-type') || ''
  const url = new URL(request.url)
  
  const maxPageDepthParam = url.searchParams.get('maxPageDepth')
  let maxPageDepth = Number(maxPageDepthParam ?? DEFAULT_MAX_PAGE_DEPTH)
  if (!Number.isInteger(maxPageDepth) || maxPageDepth <= 0) {
    maxPageDepth = maxPageDepth === 0 ? 1 : DEFAULT_MAX_PAGE_DEPTH
  }

  // The URL is formed of ZONE_ID/ACTION.
  const path = url.pathname.split('/')
  const zoneId = path[1]
  const action = path[2]

  // Only POST method is allowed
  if (request.method !== 'POST') {
    return new Response(`Method ${request.method} not allowed.`, { status: 405 })
  }

  // Only JSON is allowed
  if (!contentType.includes('application/json')) {
    return new Response('Bad Request', { status: 400 })
  }

  // Parse the body request from the webhook.
  const body = await parseWebhookBody(request)
  
  // Determine the URLs to purge from the cache for the action.
  const urlsToPurge = determineUrlsToPurgeForAction(action, body, maxPageDepth)
  if (urlsToPurge === null) {
    // Unkown request action
    return new Response('Bad Request', { status: 400 })
  }

  // Purge the URLs from Cloudflare Cache.
  const response = await purgeUrls(urlsToPurge, zoneId, apiToken)
  return await buildResponse(response, zoneId, urlsToPurge)
}

/**
 * Determine the URLs to purge from the cache based on the action.
 *
 * @param {string} action The action from the webhook
 * @param {Object} body The body of the request
 * @param {number} maxPageDepth The maximum page depth for listing URLs to purge
 * @returns {Array} The URLs to purge from the cache
 */
function determineUrlsToPurgeForAction(action, body, maxPageDepth) {
  const article = body.post ?? body.page
  const articleUrl = new URL(article.current.url)
  const rootUrl = articleUrl.protocol + '//' + articleUrl.host
  const sitemapUrl = rootUrl + '/sitemap-posts.xml'

  // Add the commmon URL to always purge.
  let urlsToPurge = [ sitemapUrl ]

  switch (action) {
    case 'postPublished':
      urlsToPurge = urlsToPurge.concat(
        determineMainListingUrlsToPurge(article, rootUrl, maxPageDepth),
        determineAuthorUrlsToPurge(article, maxPageDepth),
        determineTagUrlsToPurge(article, maxPageDepth),
      )
      break

    case 'postUpdated':
      urlsToPurge.push(articleUrl)

      // If any of the listing-related fields have changed, we need to purge the homepage.
      if (listingRelatedFields.some(field => article.previous[field])) {
        urlsToPurge = urlsToPurge.concat(
          determineMainListingUrlsToPurge(article, rootUrl, maxPageDepth),
          determineAuthorUrlsToPurge(article, maxPageDepth),
          determineTagUrlsToPurge(article, maxPageDepth),
        )
      }
      break

    case 'postUnpublished':
      urlsToPurge = urlsToPurge.concat(
        articleUrl,
        determineMainListingUrlsToPurge(article, rootUrl, maxPageDepth),
        determineAuthorUrlsToPurge(article, maxPageDepth),
        determineTagUrlsToPurge(article, maxPageDepth),
      )
      break
    
    case 'pagePublished':
      // No need to do any more for published pages, as they are not in any listings.
      break
    
    case 'pageUpdated':
    case 'pageUnpublished':
      urlsToPurge.push(articleUrl)
      break
      
    default:
      return null
  }

  return urlsToPurge
}

function determineMainListingUrlsToPurge(article, rootUrl, maxPageDepth) {
  // The majority of Ghost themes use the homepage as the main listing page.
  const urlsToPurge = [rootUrl]
  for (let i = 2; i <= maxPageDepth; i++) {
    urlsToPurge.push(`${rootUrl}/page/${i}/`)
  }

  return urlsToPurge;
}

function determineMetadataUrlsToPurge(article, maxPageDepth, metadataSelector) {
  const extractUrls = (metadata) => Array.isArray(metadata) ? metadata.map(meta => meta.url) : []
  
  const currentMetadataUrls = extractUrls(metadataSelector(article?.current))
  const previousMetadataUrls = extractUrls(metadataSelector(article?.previous))

  let urlsToPurge = currentMetadataUrls.concat(previousMetadataUrls)
  urlsToPurge.forEach(url => {
    for (let i = 2; i <= maxPageDepth; i++) {
      urlsToPurge.push(`${url}page/${i}/`)
    }
  })

  return urlsToPurge.concat(previousMetadataUrls)
}

function determineAuthorUrlsToPurge(article, maxPageDepth) {
  return determineMetadataUrlsToPurge(article, maxPageDepth, (state) => state?.authors)
}

function determineTagUrlsToPurge(article, maxPageDepth) {
  return determineMetadataUrlsToPurge(article, maxPageDepth, (state) => state?.tags)
}

async function buildResponse(response, zoneId, urlsToPurge) {
  // The purge has failed.
  if (!response.ok) {
    console.log(`🧹 Purge Failed: ${response.statusText} - ${zoneId} > ${urlsToPurge}`)
    return new Response(response.statusText, { status: response.status })
  }

  // The purge was unsuccessful.
  const body = await response.json()
  if (body.success !== true) {
    console.log(`🧹 Purge Error: ${response.body.errors?.[0]?.message} - ${zoneId} > ${urlsToPurge}`)
    return new Response('Purge failed', { status: 500 })
  }

  // Success!
  console.log(`🧹 Purged: ${zoneId} > ${urlsToPurge}`)
  return new Response('OK', { status: 200 })
}

/**
 * Uses the Cloudflare API to purge a URL from the cache; can't use the Worker Cache API
 * because it only works per datacenter. Using the Cloudflare API ensures global purge.
 *
 * @param {Array} urlsToPurge URLs to purge from the cache
 * @param {string} zoneId The Cloudflare Zone ID
 * @returns {Promise<Response>} Response from Cloudflare API
 */
async function purgeUrls(urlsToPurge, zoneId, apiToken) {
  // We convert the array to a json string.
  const urls = JSON.stringify(urlsToPurge)

  const requestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: `{"files":${urls}}`,
  }

  return await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
    requestInit,
  )
}

/**
 * Parse the body request.
 *
 * @param {json} request
 * @returns {Object} The parsed json request
 */
async function parseWebhookBody(request) {
  const body = JSON.stringify(await request.json())

  return JSON.parse(body)
}
