import { withPlatformProxy } from "../lib/platform/proxy.js";
export { createProjectUploadHandler } from "../lib/project-request/upload-handler.js";
import platformHandler from "../lib/project-request/upload-handler.js";
export default withPlatformProxy(platformHandler);
