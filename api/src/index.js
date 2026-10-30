const { app } = require("@azure/functions");
const { registerAuthorization } = require("./shared/authorization");

registerAuthorization(app);

require("./functions/branding");
require("./functions/content");
require("./functions/favorites");
require("./functions/registration");
require("./functions/schedule");
require("./functions/speakers");
require("./functions/sponsors");
