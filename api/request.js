import { withPlatformProxy } from "../lib/platform/proxy.js";
export { createProjectRequestHandler } from "../lib/project-request/handler.js";
import platformHandler from "../lib/project-request/handler.js";
export default withPlatformProxy(platformHandler);
