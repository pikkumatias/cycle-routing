// Test helper for the API handlers; kept out of the deployment by .vercelignore.

export function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = value
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: unknown) {
      res.body = data
      return res
    },
  }
  return res
}

/** The URL of the n-th call to a stubbed `fetch`. */
export function fetchedUrl(fetchMock: { mock: { calls: unknown[][] } }, n = 0): URL {
  return new URL(String(fetchMock.mock.calls[n][0]))
}
