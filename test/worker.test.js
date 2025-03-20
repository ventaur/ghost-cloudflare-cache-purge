import 'chai/register-should.js'
import { loadJsonFile } from 'load-json-file'
import nock from 'nock'

import arrayMembersAreEqual from './compareArrays.js'
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

const env = {
  CF_API_TOKEN: 'fake-token',
}

const baseRequestInit = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
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
  'custom_excerpt', 'plaintext'
]

function bodyFilesMatchUrls(body, urls) {
  return arrayMembersAreEqual(body.files, urls)
}

function getPurgeCacheUrl(zone) {
  return `/client/v4/zones/${zone}/purge_cache`
}

describe('Worker handler', function () {
  this.afterEach(() => {
    nock.cleanAll()
  })

  const methods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
  methods.forEach((method) => {
    it(`should return 405 for ${method} request`, async function () {
      const init = { ...baseRequestInit, method: method }
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = JSON.stringify(actionPostPublished.body)
      }

      const request = new Request(actionPostPublished.zone1Url, init)
      const response = await worker.fetch(request, env)
      response.status.should.equal(405)
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
    it(`should return 400 for ${mediaType} request`, async function () {
      const request = new Request(actionPostPublished.zone1Url, {
        method: baseRequestInit.method,
        headers: { 'Content-Type': mediaType },
        body: JSON.stringify(actionPostPublished.body),
      })
      const response = await worker.fetch(request, env)
      response.status.should.equal(400)
    })
  })

  it('should return 400 for request without content type', async function () {
    const request = new Request(actionPostPublished.zone1Url, {
      method: baseRequestInit.method,
      body: JSON.stringify(actionPostPublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(400)
  })

  it('should return 400 for request with invalid action', async function () {
    const url = `${BASE_WORKER_URL}/${ZONE1}/invalidAction`
    const request = new Request(url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPostPublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(400)
  })

  it('should return error status from Cloudflare API', async function () {
    const scope = nock(BASE_CLOUDFLARE_API_URL).post(getPurgeCacheUrl(ZONE1)).reply(500)

    const request = new Request(actionPostPublished.zone1Url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPostPublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(500)
    scope.isDone().should.be.true
  })

  it('should include the Cloudflare API token in the request', async function () {
    const scope = nock(BASE_CLOUDFLARE_API_URL, {
      reqheaders: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
      },
    })
      .post(getPurgeCacheUrl(ZONE1))
      .reply(200)

    const request = new Request(actionPostPublished.zone1Url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPostPublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(200)
    scope.isDone().should.be.true
  })

  it('should purge the sitemap and root URLs for postPublished', async function () {
    const expectedUrls = [SITEMAP_URL, BASE_GHOST_URL]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200)

    const request = new Request(actionPostPublished.zone1Url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPostPublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(200)
    scope.isDone().should.be.true
  })

  it('should purge the sitemap and post URLs for postUpdated with non-listing-related field change', async function () {
    const expectedUrls = [SITEMAP_URL, actionPostUpdated.body.post.current.url]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200)

    const request = new Request(actionPostUpdated.zone1Url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPostUpdated.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(200)
    scope.isDone().should.be.true
  })

  listingRelatedFields.forEach((field) => {
    it(`should purge the sitemap, root, and post URLs for postUpdated with ${field} field change`, async function () {
      const expectedUrls = [SITEMAP_URL, BASE_GHOST_URL, actionPostUpdated.body.post.current.url]

      const scope = nock(BASE_CLOUDFLARE_API_URL)
        .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
        .reply(200)

      actionPostUpdated.body.post.previous[field] = 'old value'
      const request = new Request(actionPostUpdated.zone1Url, {
        ...baseRequestInit,
        body: JSON.stringify(actionPostUpdated.body),
      })
      const response = await worker.fetch(request, env)
      response.status.should.equal(200)
      scope.isDone().should.be.true
    })
  })

  it('should purge the sitemap, root, and post URLs for postUnpublished', async function () {
    const expectedUrls = [SITEMAP_URL, BASE_GHOST_URL, actionPostUnpublished.body.post.current.url]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200)

    const request = new Request(actionPostUnpublished.zone1Url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPostUnpublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(200)
    scope.isDone().should.be.true
  })

  it('should purge the sitemap URL for pagePublished', async function () {
    const expectedUrls = [SITEMAP_URL]

    const scope = nock(BASE_CLOUDFLARE_API_URL)
      .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
      .reply(200)

    const request = new Request(actionPagePublished.zone1Url, {
      ...baseRequestInit,
      body: JSON.stringify(actionPagePublished.body),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(200)
    scope.isDone().should.be.true
  })

  const similarPageActions = [actionPageUpdated, actionPageUnpublished]
  similarPageActions.forEach((action) => {
    it(`should purge the sitemap and page URLs for ${action.actionName}`, async function () {
      const expectedUrls = [SITEMAP_URL, action.body.page.current.url]

      const scope = nock(BASE_CLOUDFLARE_API_URL)
        .post(getPurgeCacheUrl(ZONE1), (body) => bodyFilesMatchUrls(body, expectedUrls))
        .reply(200)

      const request = new Request(action.zone1Url, {
        ...baseRequestInit,
        body: JSON.stringify(actionPageUpdated.body),
      })
      const response = await worker.fetch(request, env)
      response.status.should.equal(200)
      scope.isDone().should.be.true
    })
  })
})
