import { withPlatformProxy } from "../lib/platform/proxy.js";
import platformHandler from "../lib/checkout/handler.js";
export default withPlatformProxy(platformHandler);
