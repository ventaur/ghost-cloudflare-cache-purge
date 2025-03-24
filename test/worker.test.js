import 'chai/register-should.js'
import { loadJsonFile } from 'load-json-file'
import nock from 'nock'

import arrayItemsAreEqual from './compareArrays.js'
import worker from '../src/index.js'

const BASE_GHOST_URL = 'https://blog.example.com'
const SITEMAP_URL = `${BASE_GHOST_URL}/sitemap-posts.xml`

const BASE_WORKER_URL = 'https://fake-worker.workers.dev'
const BASE_CLOUDFLARE_API_URL = 'https://api.cloudflare.com'
const ZONE1 = 'zone-1'
const ZONE2 = 'zone-2'
const POST_PUBLISHED = 'postPublished'
const POST_UPDATED = 'postUpdated'
const POST_UNPUBLISHED = 'postUnpublished'
const PAGE_PUBLISHED = 'pagePublished'
const PAGE_UPDATED = 'pageUpdated'
const PAGE_UNPUBLISHED = 'pageUnpublished'

const ENV = {
  CF_API_TOKEN: 'fake-token',
}

const actionPostPublished = {
  actionName: POST_PUBLISHED,
  zone1Url: `${BASE_WORKER_URL}/${ZONE1}/${POST_PUBLISHED}`,
  zone2Url: `${BASE_WORKER_URL}/${ZONE2}/${POST_PUBLISHED}`,
  body: await loadJsonFile('./test/fixtures/postPublished.json'),
}
const actionPostUpdated = {
  actionName: POST_UPDATED,
  zone1Url: `${BASE_WORKER_URL}/${ZONE1}/${POST_UPDATED}`,
  zone2Url: `${BASE_WORKER_URL}/${ZONE2}/${POST_UPDATED}`,
  body: await loadJsonFile('./test/fixtures/postUpdated.json'),
}
const actionPostUnpublished = {
  actionName: POST_UNPUBLISHED,
  zone1Url: `${BASE_WORKER_URL}/${ZONE1}/${POST_UNPUBLISHED}`,
  zone2Url: `${BASE_WORKER_URL}/${ZONE2}/${POST_UNPUBLISHED}`,
  body: await loadJsonFile('./test/fixtures/postUnpublished.json'),
}
const actionPagePublished = {
  actionName: PAGE_PUBLISHED,
  zone1Url: `${BASE_WORKER_URL}/${ZONE1}/${PAGE_PUBLISHED}`,
  zone2Url: `${BASE_WORKER_URL}/${ZONE2}/${PAGE_PUBLISHED}`,
  body: await loadJsonFile('./test/fixtures/pagePublished.json'),
}
const actionPageUpdated = {
  actionName: PAGE_UPDATED,
  zone1Url: `${BASE_WORKER_URL}/${ZONE1}/${PAGE_UPDATED}`,
  zone2Url: `${BASE_WORKER_URL}/${ZONE2}/${PAGE_UPDATED}`,
  body: await loadJsonFile('./test/fixtures/pageUpdated.json'),
}
const actionPageUnpublished = {
  actionName: PAGE_UNPUBLISHED,
  zone1Url: `${BASE_WORKER_URL}/${ZONE1}/${PAGE_UNPUBLISHED}`,
  zone2Url: `${BASE_WORKER_URL}/${ZONE2}/${PAGE_UNPUBLISHED}`,
  body: await loadJsonFile('./test/fixtures/pageUnpublished.json'),
}

// Fields that are related to post listings and should trigger a purge of the homepage.
const listingRelatedFields = [
  'published_at', 'visibility', 
  'title', 'slug', 
  'featured', 'feature_image', 'feature_image_alt', 'feature_image_caption', 
  'custom_excerpt', 'plaintext',
  'authors', 'tags'
]


function buildRequest(action, requestOverrides = {}) {
  const requestInfo = {
    url: action.zone1Url,
    maxPageDepth: undefined,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(action.body),
    ...requestOverrides
  
  }
  if (requestInfo.maxPageDepth !== undefined) {
    requestInfo.url += `?maxPageDepth=${requestInfo.maxPageDepth}`
  }

  return new Request(requestInfo.url, requestInfo)
}

function buildScope(scopeOverrides = {}) {
  const scopeInfo = {
    url: getPurgeCacheUrl(ZONE1),
    options: undefined,
    expectedUrls: undefined,
    requestBodyMatcher: undefined,
    times: 1,
    status: 200,
    responseBody: { success: true },
    ...scopeOverrides
  }

  if (Array.isArray(scopeInfo.expectedUrls)) {
    scopeInfo.requestBodyMatcher = (body) => bodyFilesMatchUrls(body, scopeInfo.expectedUrls)
  }

  return nock(BASE_CLOUDFLARE_API_URL, scopeInfo.options)
    .post(scopeInfo.url, scopeInfo.requestBodyMatcher)
    .times(scopeInfo.times)
    .reply(scopeInfo.status, scopeInfo.responseBody)
}

function bodyFilesMatchUrls(body, urls) {
  return arrayItemsAreEqual(body.files, urls)
}

function getPurgeCacheUrl(zone) {
  return `/client/v4/zones/${zone}/purge_cache`
}

async function actAndAssertResponse(request, expectedStatus, additionalEnv = {}) {
  if (expectedStatus === undefined || !Number.isInteger(expectedStatus) || expectedStatus < 200 || expectedStatus > 599) {
    throw new Error('expectedStatus must be a valid HTTP status code (200-599).')
  }

  const env = {
    ...ENV,
    ...additionalEnv
  }

  const response = await worker.fetch(request, env)
  response.status.should.equal(expectedStatus)
}


describe('Worker handler should', function () {
  this.afterEach(() => {
    nock.isDone().should.be.true
    nock.cleanAll()
  })

  const methods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
  methods.forEach((method) => {
    it(`return 405 for ${method} request`, async function () {
      const requestOverrides = { method: method }
      if (method === 'GET' || method === 'HEAD') {
        requestOverrides.body = undefined
      }

      const request = buildRequest(actionPostPublished, requestOverrides)
      await actAndAssertResponse(request, 405)
    })
  })

  const mediaTypes = [
    'text/plain',
    'text/csv',
    'text/html',
    'image/jpeg',
    'application/xml',
    'application/ld+json',
  ]
  mediaTypes.forEach((mediaType) => {
    it(`return 400 for ${mediaType} request`, async function () {
      const request = buildRequest(actionPostPublished, { headers: { 'Content-Type': mediaType } })
      await actAndAssertResponse(request, 400)
    })
  })

  it('return 400 for request without content type', async function () {
    const request = buildRequest(actionPostPublished, { headers: {} })
    await actAndAssertResponse(request, 400)
  })

  it('return 400 for request with invalid action', async function () {
    const url = `${BASE_WORKER_URL}/${ZONE1}/invalidAction`
    const request = buildRequest(actionPostPublished, { url })
    await actAndAssertResponse(request, 400)
  })

  it('return error status from Cloudflare API', async function () {
    buildScope({ status: 500, responseBody: undefined })
    const request = buildRequest(actionPostPublished)
    await actAndAssertResponse(request, 500)
  })

  // NOTE: There is a bug in nock that prevents it from testing request headers for a match.
  // So, there is no way to make this test fail appropriately, even if you change the expected header name or value; it always passes.
  // https://github.com/nock/nock/issues/2545
  it('include the Cloudflare API token in the request', async function () {
    const options = {
      reqHeaders: {
        Authorization: `Bearer ${ENV.CF_API_TOKEN}`
      }
    }
    buildScope({ options })
    const request = buildRequest(actionPostPublished)
    await actAndAssertResponse(request, 200)
  })

  it('purge sitemap and all listing URLs for postPublished', async function () {
    const expectedUrls = [
      SITEMAP_URL,
      BASE_GHOST_URL,
      `${BASE_GHOST_URL}/author/maiq/`,
      `${BASE_GHOST_URL}/tag/gaming/`,
      `${BASE_GHOST_URL}/tag/news/`,
    ]

    buildScope({ expectedUrls })
    const request = buildRequest(actionPostPublished, { maxPageDepth: 1 })
    await actAndAssertResponse(request, 200)
  })

  it('purge sitemap and post URLs for postUpdated with non-listing-related field change', async function () {
    const expectedUrls = [SITEMAP_URL, actionPostUpdated.body.post.current.url]

    buildScope({ expectedUrls })
    const request = buildRequest(actionPostUpdated)
    await actAndAssertResponse(request, 200)
  })

  listingRelatedFields.forEach((field) => {
    it(`purge sitemap and all listing URLs for postUpdated with ${field} field change`, async function () {
      const expectedUrls = [
        SITEMAP_URL,
        BASE_GHOST_URL,
        actionPostUpdated.body.post.current.url,
        `${BASE_GHOST_URL}/author/maiq/`,
        `${BASE_GHOST_URL}/tag/gaming/`,
        `${BASE_GHOST_URL}/tag/news/`,
      ]

      const actionCopy = { ...actionPostUpdated }
      actionCopy.body.post.previous.other_field = 'something'
      actionCopy.body.post.previous[field] = 'old value'
      
      buildScope({ expectedUrls })
      const request = buildRequest(actionCopy, { maxPageDepth: 1 })
      await actAndAssertResponse(request, 200)
    })
  })

  it('purge sitemap and all listing URLs for postUnpublished', async function () {
    const expectedUrls = [
      SITEMAP_URL,
      BASE_GHOST_URL,
      actionPostUnpublished.body.post.current.url,
      `${BASE_GHOST_URL}/author/maiq/`,
      `${BASE_GHOST_URL}/tag/gaming/`,
      `${BASE_GHOST_URL}/tag/news/`,
    ]

    buildScope({ expectedUrls })
    const request = buildRequest(actionPostUnpublished, { maxPageDepth: 1 })
    await actAndAssertResponse(request, 200)
  })

  it('purge sitemap URL for pagePublished', async function () {
    const expectedUrls = [SITEMAP_URL]

    buildScope({ expectedUrls })
    const request = buildRequest(actionPagePublished)
    await actAndAssertResponse(request, 200)
  })

  const similarPageActions = [actionPageUpdated, actionPageUnpublished]
  similarPageActions.forEach((action) => {
    it(`purge sitemap and page URLs for ${action.actionName}`, async function () {
      const expectedUrls = [SITEMAP_URL, action.body.page.current.url]

      buildScope({ expectedUrls })
      const request = buildRequest(action)
      await actAndAssertResponse(request, 200)
    })
  })

  const postActions = [actionPostPublished, actionPostUpdated, actionPostUnpublished]
  postActions.forEach((action) => {
    it(`purge numbered pages of listing URLs for ${action.actionName}`, async function () {
      const expectedUrls = [
        SITEMAP_URL,
        BASE_GHOST_URL,
        `${BASE_GHOST_URL}/page/2/`,
        `${BASE_GHOST_URL}/page/3/`,
        `${BASE_GHOST_URL}/page/4/`,
        `${BASE_GHOST_URL}/page/5/`,
        `${BASE_GHOST_URL}/author/maiq/`,
        `${BASE_GHOST_URL}/author/maiq/page/2/`,
        `${BASE_GHOST_URL}/author/maiq/page/3/`,
        `${BASE_GHOST_URL}/author/maiq/page/4/`,
        `${BASE_GHOST_URL}/author/maiq/page/5/`,
        `${BASE_GHOST_URL}/tag/gaming/`,
        `${BASE_GHOST_URL}/tag/gaming/page/2/`,
        `${BASE_GHOST_URL}/tag/gaming/page/3/`,
        `${BASE_GHOST_URL}/tag/gaming/page/4/`,
        `${BASE_GHOST_URL}/tag/gaming/page/5/`,
        `${BASE_GHOST_URL}/tag/news/`,
        `${BASE_GHOST_URL}/tag/news/page/2/`,
        `${BASE_GHOST_URL}/tag/news/page/3/`,
        `${BASE_GHOST_URL}/tag/news/page/4/`,
        `${BASE_GHOST_URL}/tag/news/page/5/`,
      ]
      if (action.actionName === POST_UPDATED || action.actionName === POST_UNPUBLISHED) {
        expectedUrls.push(action.body.post.current.url)
      }

      if (action.actionName === POST_UPDATED) {
        action = { ...actionPostUpdated }
        action.body.post.previous[listingRelatedFields[0]] = 'old value'
      }

      buildScope({ url: getPurgeCacheUrl(ZONE2), expectedUrls })
      const request = buildRequest(action, { url: action.zone2Url, maxPageDepth: 5 })
      await actAndAssertResponse(request, 200)
    })
  })

  it('purge 3 numbered pages of listing URLs by default', async function () {
    const expectedUrls = [
      SITEMAP_URL,
      BASE_GHOST_URL,
      `${BASE_GHOST_URL}/page/2/`,
      `${BASE_GHOST_URL}/page/3/`,
      `${BASE_GHOST_URL}/author/maiq/`,
      `${BASE_GHOST_URL}/author/maiq/page/2/`,
      `${BASE_GHOST_URL}/author/maiq/page/3/`,
      `${BASE_GHOST_URL}/tag/gaming/`,
      `${BASE_GHOST_URL}/tag/gaming/page/2/`,
      `${BASE_GHOST_URL}/tag/gaming/page/3/`,
      `${BASE_GHOST_URL}/tag/news/`,
      `${BASE_GHOST_URL}/tag/news/page/2/`,
      `${BASE_GHOST_URL}/tag/news/page/3/`,
    ]

    buildScope({ url: getPurgeCacheUrl(ZONE2), expectedUrls })
    const request = buildRequest(actionPostPublished, { url: actionPostPublished.zone2Url })
    await actAndAssertResponse(request, 200)
  })

  it('purge no numbered pages of listing URLs when maxPageDepth is 0 or 1', async function () {
    const expectedUrls = [
      SITEMAP_URL,
      BASE_GHOST_URL,
      `${BASE_GHOST_URL}/author/maiq/`,
      `${BASE_GHOST_URL}/tag/gaming/`,
      `${BASE_GHOST_URL}/tag/news/`,
    ]

    // We're going to call the worker twice, once with maxPageDepth=0 and once with maxPageDepth=1.
    buildScope({ expectedUrls })
     buildScope({ url: getPurgeCacheUrl(ZONE2), expectedUrls })
    let request = buildRequest(actionPostPublished, { maxPageDepth: 0 })
    await actAndAssertResponse(request, 200)

    request = buildRequest(actionPostPublished, { url: actionPostPublished.zone2Url, maxPageDepth: 1 })
    await actAndAssertResponse(request, 200)
  })

  const urlsPerCallScenarios = [
    { env: { CF_IS_ENTERPRISE: 'true' }, expectedRequests: 1 },
    { env: { CF_IS_ENTERPRISE: 'TRUE' }, expectedRequests: 1 },
    { env: { CF_IS_ENTERPRISE: '1' }, expectedRequests: 1 },
    { env: {}, expectedRequests: 2 },
  ]
  urlsPerCallScenarios.forEach(({ env, expectedRequests }) => {
    it(`purge more than 30 URLs by making ${expectedRequests === 1 ? 'a single request' : 'multiple requests'} for env.CF_IS_ENTERPRISE '${env?.CF_IS_ENTERPRISE}'`, async function () {
      // Use a maxPageDepth of 10 to generate more than 30 URLs for the test.
      const maxPageDepth = 10
      const expectedUrls = [
        SITEMAP_URL,
        BASE_GHOST_URL,
        `${BASE_GHOST_URL}/author/maiq/`,
        `${BASE_GHOST_URL}/tag/gaming/`,
        `${BASE_GHOST_URL}/tag/news/`,
      ].concat(
        Array.from({ length: maxPageDepth - 1 }, (_, i) => `${BASE_GHOST_URL}/page/${i + 2}/`),
        Array.from({ length: maxPageDepth - 1 }, (_, i) => `${BASE_GHOST_URL}/author/maiq/page/${i + 2}/`),
        Array.from({ length: maxPageDepth - 1 }, (_, i) => `${BASE_GHOST_URL}/tag/gaming/page/${i + 2}/`),
        Array.from({ length: maxPageDepth - 1 }, (_, i) => `${BASE_GHOST_URL}/tag/news/page/${i + 2}/`),
      )

      const actualUrls = []

      // We expect the worker to make two requests to the Cloudflare API, each with a maximum of 30 URLs.
      // We'll capture the URLs sent in each request to compare them against the expected URLs.
      buildScope({ requestBodyMatcher: (body) => actualUrls.push(...body.files), times: expectedRequests })
      const request = buildRequest(actionPostPublished, { maxPageDepth })
      await actAndAssertResponse(request, 200, env)

      // Sort the URLs to ensure the order doesn't affect the comparison.
      expectedUrls.sort()
      actualUrls.sort()
      actualUrls.should.be.deep.equal(expectedUrls)
    })
  })
})
