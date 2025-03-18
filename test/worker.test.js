import 'chai/register-should.js'
import { loadJsonFile } from 'load-json-file'

import worker from '../src/index.js'

const BASE_WORKER_URL = 'https://fake-worker.workers.dev'
const ZONE1 = 'zone-1'
const ZONE2 = 'zone-2'
const POST_PUBLISHED = 'postPublished'
const POST_UPDATED = 'postUpdated'

const WORKER_ZONE1_POST_PUBLISHED_URL = `${BASE_WORKER_URL}/${ZONE1}/${POST_PUBLISHED}`
const WORKER_ZONE1_POST_UPDATED_URL = `${BASE_WORKER_URL}/${ZONE1}/${POST_UPDATED}`
const WORKER_ZONE2_POST_PUBLISHED_URL = `${BASE_WORKER_URL}/${ZONE2}/${POST_PUBLISHED}`
const WORKER_ZONE2_POST_UPDATED_URL = `${BASE_WORKER_URL}/${ZONE2}/${POST_UPDATED}`

const env = {
  CF_API_TOKEN: 'fake-token',
}

const baseRequestInit = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
}

const postPublishedBody = await loadJsonFile(
  './test/fixtures/postPublished.json',
)

describe('Worker handler', function () {
  const methods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
  methods.forEach((method) => {
    it(`should return 405 for ${method} request`, async function () {
      const init = { ...baseRequestInit, method: method }
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = JSON.stringify(postPublishedBody)
      }

      const request = new Request(WORKER_ZONE1_POST_PUBLISHED_URL, init)
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
      const request = new Request(WORKER_ZONE1_POST_PUBLISHED_URL, {
        method: baseRequestInit.method,
        headers: { 'Content-Type': mediaType },
        body: JSON.stringify(postPublishedBody),
      })
      const response = await worker.fetch(request, env)
      response.status.should.equal(400)
    })
  })

  it(`should return 400 for request without content type`, async function () {
    const request = new Request(WORKER_ZONE1_POST_PUBLISHED_URL, {
      method: baseRequestInit.method,
      body: JSON.stringify(postPublishedBody),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(400)
  })

  it(`should return 400 for request with invalid action`, async function () {
    const url = `${BASE_WORKER_URL}/${ZONE1}/invalidAction`
    const request = new Request(url, {
      ...baseRequestInit,
      body: JSON.stringify(postPublishedBody),
    })
    const response = await worker.fetch(request, env)
    response.status.should.equal(400)
  })
})
