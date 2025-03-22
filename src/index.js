export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
}

// Fields that are typically displayed on post listings and should trigger a purge of the listing URLs.
const listingRelatedFields = [
  'published_at', 'visibility', 
  'title', 'slug', 
  'featured', 'feature_image', 'feature_image_alt', 'feature_image_caption', 
  'custom_excerpt', 'plaintext',
  'authors', 'tags'
]

/**
 * Get a request from Ghost CMS webhook.
 *
 * @param {*} request The HTTP request Object
 * @param {*} env The environment variables
 * @returns An HTTP Response
 */
async function handleRequest(request, env) {
  const { headers } = request
  const contentType = headers.get('content-type') || ''
  const url = new URL(request.url)
  const apiToken = env.CF_API_TOKEN

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
  
  // Determine the URLs to purge from the cache based on the action.
  const urlsToPurge = determineUrlsToPurgeForAction(action, body)
  if (urlsToPurge === null) {
    // Unkown request action
    return new Response('Bad Request', { status: 400 })
  }

  // Purge the URLs from Cloudflare Cache.
  const resp = await purgeUrls(urlsToPurge, zoneId, apiToken)

  // The purge has failed.
  if (!resp.ok) {
    console.log(`🧹 Purge Error : ${resp.statusText} - ${zoneId} > ${urlsToPurge}`)
    return new Response(resp.statusText, { status: resp.status })
  }

  // Success
  console.log(`🧹 Purged: ${zoneId} > ${urlsToPurge}`)
  return new Response('OK', { status: 200 })
}

/**
 * Determine the URLs to purge from the cache based on the action.
 *
 * @param {string} action The action from the webhook
 * @param {Object} body The body of the request
 * @returns {Array} The URLs to purge from the cache
 */
function determineUrlsToPurgeForAction(action, body) {
  const article = body.post ?? body.page
  const articleUrl = new URL(article.current.url)
  const rootUrl = articleUrl.protocol + '//' + articleUrl.host
  const sitemapUrl = rootUrl + '/sitemap-posts.xml'

  // Add the commmon URL to always purge.
  let urlsToPurge = [ sitemapUrl ]

  switch (action) {
    case 'postPublished':
      urlsToPurge = urlsToPurge.concat(
        determineMainListingUrlsToPurge(article, rootUrl),
        determineAuthorUrlsToPurge(article),
        determineTagUrlsToPurge(article),
      )
      break

    case 'postUpdated':
      urlsToPurge.push(articleUrl)

      // If any of the listing-related fields have changed, we need to purge the homepage.
      if (listingRelatedFields.some(field => article.previous[field])) {
        urlsToPurge = urlsToPurge.concat(
          determineMainListingUrlsToPurge(article, rootUrl),
          determineAuthorUrlsToPurge(article),
          determineTagUrlsToPurge(article),
        )
      }
      break

    case 'postUnpublished':
      urlsToPurge = urlsToPurge.concat(
        articleUrl,
        determineMainListingUrlsToPurge(article, rootUrl),
        determineAuthorUrlsToPurge(article),
        determineTagUrlsToPurge(article),
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

function determineMainListingUrlsToPurge(article, rootUrl) {
  // The majority of Ghost themes use the homepage as the main listing page.
  return rootUrl;
}

function determineMetadataUrlsToPurge(article, metadataSelector) {
  const extractUrls = (metadata) => Array.isArray(metadata) ? metadata.map(meta => meta.url) : []
  
  const currentAuthors = extractUrls(metadataSelector(article?.current))
  const previousAuthors = extractUrls(metadataSelector(article?.previous))

  return currentAuthors.concat(previousAuthors)
}

function determineAuthorUrlsToPurge(article) {
  return determineMetadataUrlsToPurge(article, (state) => state?.authors)
}

function determineTagUrlsToPurge(article) {
  return determineMetadataUrlsToPurge(article, (state) => state?.tags)
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
