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
    const scope = nock(BASE_CLOUDFLARE_API_URL).post(getPurgeCacheUrl(ZONE1)).reply(500)

    const request = buildRequest(actionPostPublished)
    await actAndAssertResponse(request, 500, scope)
  })

  it('include the Cloudflare API token in the request', async function () {
    const scope = nock(BASE_CLOUDFLARE_API_URL, {
      reqheaders: {
        Authorization: `Bearer ${ENV.CF_API_TOKEN}`,
      },
    })
      .post(getPurgeCacheUrl(ZONE1))
      .reply(200, { success: true })

    const request = buildRequest(actionPostPublished)
    await actAndAssertResponse(request, 200, scope)
  })

  it('purge sitemap and all listing URLs for postPublished', async function () {
    const expectedUrls = [
      SITEMAP_URL,
      BASE_GHOST_URL,
      `${BASE_GHOST_URL}/author/maiq/`,
      `${BASE_GHOST_URL}/tag/gaming/`,
      `${BASE_GHOST_URL}/tag/news/`,
    ]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })

    const request = buildRequest(actionPostPublished, { maxPageDepth: 1 })
    await actAndAssertResponse(request, 200, scope)
  })

  it('purge sitemap and post URLs for postUpdated with non-listing-related field change', async function () {
    const expectedUrls = [SITEMAP_URL, actionPostUpdated.body.post.current.url]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })

    const request = buildRequest(actionPostUpdated)
    await actAndAssertResponse(request, 200, scope)
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

      const scope = nock(BASE_CLOUDFLARE_API_URL)
        .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
        .reply(200, { success: true })

      actionPostUpdated.body.post.previous.other_field = 'something'
      actionPostUpdated.body.post.previous[field] = 'old value'

      const request = buildRequest(actionPostUpdated, { maxPageDepth: 1 })
      await actAndAssertResponse(request, 200)
      scope.done()
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

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })

    const request = buildRequest(actionPostUnpublished, { maxPageDepth: 1 })
    await actAndAssertResponse(request, 200)
    scope.done()
  })

  it('purge sitemap URL for pagePublished', async function () {
    const expectedUrls = [SITEMAP_URL]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })

    const request = buildRequest(actionPagePublished)
    await actAndAssertResponse(request, 200)
    scope.done()
  })

  const similarPageActions = [actionPageUpdated, actionPageUnpublished]
  similarPageActions.forEach((action) => {
    it(`purge sitemap and page URLs for ${action.actionName}`, async function () {
      const expectedUrls = [SITEMAP_URL, action.body.page.current.url]

      const scope = nock(BASE_CLOUDFLARE_API_URL)
        .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
        .reply(200, { success: true })

      const request = buildRequest(action)
      await actAndAssertResponse(request, 200)
      scope.done()
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

      const scope = nock(BASE_CLOUDFLARE_API_URL)
        .post(getPurgeCacheUrl(ZONE2), (body) => bodyFilesMatchUrls(body, expectedUrls))
        .reply(200, { success: true })

      const request = buildRequest(action, { url: action.zone2Url, maxPageDepth: 5 })
      await actAndAssertResponse(request, 200)
      scope.done()
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

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE2), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })

    const request = buildRequest(actionPostPublished, { url: actionPostPublished.zone2Url })
    await actAndAssertResponse(request, 200)
    scope.done()
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
    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })
      .post(getPurgeCacheUrl(ZONE2), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200, { success: true })

    let request = buildRequest(actionPostPublished, { maxPageDepth: 0 })
    await actAndAssertResponse(request, 200)

    request = buildRequest(actionPostPublished, { url: actionPostPublished.zone2Url, maxPageDepth: 1 })
    await actAndAssertResponse(request, 200)

    scope.done()
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
      const scope = nock(BASE_CLOUDFLARE_API_URL)
        .post(getPurgeCacheUrl(ZONE2), (body) => actualUrls.push(...body.files))
        .times(expectedRequests)
        .reply(200, { success: true })

      const request = buildRequest(actionPostPublished, { url: actionPostPublished.zone2Url, maxPageDepth })
      await actAndAssertResponse(request, 200, env)
      scope.done()

      // Sort the URLs to ensure the order doesn't affect the comparison.
      expectedUrls.sort()
      actualUrls.sort()
      actualUrls.should.be.deep.equal(expectedUrls)
    })
  })
})
