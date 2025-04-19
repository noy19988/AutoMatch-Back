"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const mongoose_1 = __importDefault(require("mongoose"));
const body_parser_1 = __importDefault(require("body-parser"));
const express_session_1 = __importDefault(require("express-session"));
const auth_route_1 = __importDefault(require("./routes/auth_route"));
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const lichess_route_1 = __importDefault(require("./routes/lichess_route"));
const app = (0, express_1.default)();
// ✅ Session Middleware
app.use((0, express_session_1.default)({
    secret: "some_secret_key", // אפשר להוציא ל־.env
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // dev בלבד. production -> true + https
}));
const db = mongoose_1.default.connection;
db.on("error", console.error);
db.once("open", () => console.log("Connected to Database"));
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
// CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
});
app.use("/auth", auth_route_1.default);
app.use("/auth/lichess", lichess_route_1.default);
app.get("/about", (_, res) => {
    res.send("Hello World!");
});
const options = {
    swaggerDefinition: {
        openapi: "3.0.0",
        info: {
            title: "Web Dev 2025 - D - REST API",
            version: "1.0.0",
            description: "REST server including authentication using JWT",
        },
        servers: [
            {
                url: `${process.env.BASE_URL}:${process.env.PORT}`,
            },
        ],
    },
    apis: ["./src/routes/*.ts"],
};
// @ts-ignore
const specs = (0, swagger_jsdoc_1.default)(options);
app.use("/api-docs", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(specs));
const initApp = () => {
    return new Promise(async (resolve, reject) => {
        if (!process.env.DB_CONNECTION) {
            reject("DB_CONNECTION is not defined");
        }
        else {
            await mongoose_1.default.connect(process.env.DB_CONNECTION);
            resolve(app);
        }
    });
};
exports.default = initApp;
