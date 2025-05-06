"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const mongoose_1 = __importDefault(require("mongoose"));
const body_parser_1 = __importDefault(require("body-parser"));
const express_session_1 = __importDefault(require("express-session"));
const auth_route_1 = __importDefault(require("./routes/auth_route"));
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const lichess_route_1 = __importDefault(require("./routes/lichess_route"));
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
// ✅ הגשת קבצי פרונט מהתיקייה ../front (חייב לבוא לפני הראוטים האחרים)
const frontendPath = path_1.default.join(__dirname, "..", "front");
app.use(express_1.default.static(frontendPath));
// ✅ כל ראוט שלא נמצא - מחזיר את index.html
app.get("*", (req, res) => {
    res.sendFile(path_1.default.join(frontendPath, "index.html"));
});
//Session Middleware
app.use((0, express_session_1.default)({
    secret: "some_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
}));
// CORS
app.use((0, cors_1.default)({
    origin: "http://localhost:5173",
    credentials: true,
}));
app.use(express_1.default.json());
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
// הגדרות CORS נוספות
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
});
// ראוטים
app.use("/auth", auth_route_1.default);
app.use("/auth/lichess", lichess_route_1.default);
app.use("/api/lichess", lichess_route_1.default);
app.use(lichess_route_1.default);
app.get("/about", (_, res) => {
    res.send("Hello World!");
});
// Swagger
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
                description: "Environment-based (from .env)"
            },
            {
                url: "https://automatch.cs.colman.ac.il",
                description: "Production (HTTPS)"
            },
            {
                url: "http://automatch.cs.colman.ac.il",
                description: "Production (HTTP - fallback)"
            },
            {
                url: "http://automatch.cs.colman.ac.il:3060",
                description: "Dev direct access (HTTP with port)"
            },
            {
                url: "http://localhost:3060",
                description: "Local development"
            }
        ]
    },
    apis: ["./src/routes/*.ts"],
};
// @ts-ignore
const specs = (0, swagger_jsdoc_1.default)(options);
app.use("/api-docs", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(specs));
// MongoDB connect + return app
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
