export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
}

/**
 * Get a request from Ghost CMS Webhook.
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

  // Only POST HTTP are allowed.
  if (request.method !== 'POST') {
    return new Response(`Method ${request.method} not allowed.`, { status: 405 })
  }

  // Only JSON POST are allowed
  if (!contentType.includes('application/json')) {
    return new Response('Bad Request', { status: 400 })
  }

  // We parse the body request from the WebHook.
  const body = await parseWebhookBody(request)
  const articleUrl = new URL(body.post ? body.post.current.url : body.page.current.url)

  const urlsToPurge = determineUrlsToPurgeForAction(action, articleUrl)

  // Unkown request action.
  if (urlsToPurge === null) {
    return new Response('Bad Request', { status: 400 })
  }

  // We purge the URL from Cloudflare Cache.
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
 * @param {string} action The action from the WebHook
 * @param {URL} postUrl The URL of the article
 * @returns {Array} The URLs to purge from the cache
 */
function determineUrlsToPurgeForAction(action, postUrl) {
  const rootUrl = postUrl.protocol + '//' + postUrl.host
  const sitemapUrl = rootUrl + '/sitemap-posts.xml'

  // Add the commmon URL to always purge.
  const urlsToPurge = [ sitemapUrl ]

  switch (action) {
    case 'postPublished':
      urlsToPurge.push(rootUrl)
      break

    case 'postUpdated':
      urlsToPurge.push(postUrl)
      break

    case 'postUnpublished':
      urlsToPurge.push(rootUrl, postUrl)
      break
    
    case 'pagePublished':
      // No need to do any more for published pages, as they are not in any listings.
      break
    
    case 'pageUpdated':
    case 'pageUnpublished':
      urlsToPurge.push(postUrl)
      break
      
    default:
      return null
  }

  return urlsToPurge
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
