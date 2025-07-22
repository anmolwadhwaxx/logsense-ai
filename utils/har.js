function createHARLog(entries) {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "Chrome Network Capture Extension",
        version: "1.0"
      },
      entries: entries
    }
  };
}

function formatEntry(request, response, startTime, endTime) {
  return {
    startedDateTime: new Date(startTime).toISOString(),
    time: endTime - startTime,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: request.httpVersion || "HTTP/1.1",
      headers: request.headers,
      queryString: request.queryString,
      postData: request.postData,
      cookies: request.cookies,
      headersSize: -1,
      bodySize: request.bodySize || -1
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      httpVersion: response.httpVersion || "HTTP/1.1",
      headers: response.headers,
      cookies: response.cookies,
      content: {
        size: response.content.size,
        mimeType: response.content.mimeType,
        text: response.content.text
      },
      redirectURL: response.redirectURL,
      headersSize: -1,
      bodySize: response.bodySize || -1
    },
    cache: {},
    timings: {
      send: 0,
      wait: endTime - startTime,
      receive: 0
    }
  };
}

export { createHARLog, formatEntry };
