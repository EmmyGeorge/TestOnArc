var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var handler_exports = {};
__export(handler_exports, {
  createBody: () => createBody,
  handle: () => handle,
  isContentTypeBinary: () => isContentTypeBinary
});
module.exports = __toCommonJS(handler_exports);
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_encode = require("../../utils/encode");
globalThis.crypto ??= import_node_crypto.default;
const convertHeaders = (headers) => {
  const cfHeaders = {};
  headers.forEach((value, key) => {
    cfHeaders[key.toLowerCase()] = [
      ...cfHeaders[key.toLowerCase()] || [],
      { key: key.toLowerCase(), value }
    ];
  });
  return cfHeaders;
};
const handle = (app) => {
  return async (event, ...args) => {
    const [context, callback] = args;
    let callbackError = null;
    let callbackResult;
    const cf = getCloudFrontRecord(event);
    const res = await app.fetch(createRequest(cf), {
      event,
      context,
      callback: (err, result) => {
        if (!callbackError && !callbackResult) {
          callbackError = err;
          callbackResult = result;
        }
        callback?.(err, result);
      },
      config: cf.config,
      request: cf.request,
      response: cf.response
    });
    if (callbackError) {
      throw callbackError;
    }
    return callbackResult ?? createResult(res);
  };
};
const createResult = async (res) => {
  const contentEncoding = res.headers.get("content-encoding");
  const isBase64Encoded = isContentTypeBinary(res.headers.get("content-type") || "") || !!contentEncoding && !/^identity$/i.test(contentEncoding);
  const body = isBase64Encoded ? (0, import_encode.encodeBase64)(await res.arrayBuffer()) : await res.text();
  return {
    status: res.status.toString(),
    headers: convertHeaders(res.headers),
    body,
    ...isBase64Encoded && { bodyEncoding: "base64" }
  };
};
const getCloudFrontRecord = (event) => {
  const cf = event?.Records?.[0]?.cf;
  if (!cf?.request) {
    throw new TypeError(
      "Unable to map the CloudFront event to a Request: expected `Records[0].cf.request` in the Lambda@Edge event."
    );
  }
  return cf;
};
const createRequest = (cf) => {
  const request = cf.request;
  const queryString = request.querystring;
  const host = request.headers?.host?.[0]?.value || cf.config?.distributionDomainName;
  const urlPath = `https://${host}${request.uri}`;
  const url = queryString ? `${urlPath}?${queryString}` : urlPath;
  const headers = new Headers();
  Object.entries(request.headers ?? {}).forEach(([k, v]) => {
    v.forEach((header) => headers.append(k, header.value));
  });
  const requestBody = request.body;
  const method = request.method;
  const rawBody = createBody(method, requestBody);
  let body = rawBody;
  if (rawBody !== void 0) {
    const bytes = typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : rawBody;
    body = bytes;
    headers.set("content-length", bytes.length.toString());
  }
  return new Request(url, {
    headers,
    method,
    body
  });
};
const createBody = (method, requestBody) => {
  if (!requestBody || !requestBody.data) {
    return void 0;
  }
  if (method === "GET" || method === "HEAD") {
    return void 0;
  }
  if (requestBody.encoding === "base64") {
    return (0, import_encode.decodeBase64)(requestBody.data);
  }
  return requestBody.data;
};
const isContentTypeBinary = (contentType) => {
  if (/^application\/vnd\.(?:apple\.installer|mozilla\.xul)\+xml\s*(?:;|$)/i.test(contentType)) {
    return true;
  }
  return !/^text\/(?:plain|html|css|javascript|csv)|(?:\/|\+)(?:json|xml)\s*(?:;|$)/i.test(
    contentType
  );
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createBody,
  handle,
  isContentTypeBinary
});
