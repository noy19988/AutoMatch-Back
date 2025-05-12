import express, { Express } from "express";
import dotenv from "dotenv";
import path from "path";
dotenv.config();

import mongoose from "mongoose";
import bodyParser from "body-parser";
import session from "express-session";
import authController from "./routes/auth_route";
import swaggerJsDoc from "swagger-jsdoc";
import swaggerUI from "swagger-ui-express";
import lichessRouter from "./routes/lichess_route";
import cors from "cors";
import apiRouter from "./routes/lichess_api_route"

const app = express();

// 🟡 הגדרת CORS
app.use(
  cors({
    origin: "https://automatch.cs.colman.ac.il",
    credentials: true,
  })
);


// 🟡 Session Middleware
app.use(
  session({
    secret: "some_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',  // <-- IMPORTANT
      httpOnly: true,
      sameSite: 'lax',
    }
  }));

// 🟡 JSON + bodyParser
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🟡 הגדרות CORS נוספות
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});



// ✅ ראוטים API
app.use("/auth", authController);
app.use("/auth/lichess", lichessRouter);
app.use("/api/lichess", apiRouter);
// app.use("/api/lichess", lichessRouter);
// app.use(lichessRouter); // אפשר להוריד אם מיותר

// ✅ Swagger Docs
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
const specs = swaggerJsDoc(options);
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(specs));

// ✅ הגשת קבצי פרונט רק אחרי הראוטים!
const frontendPath = path.join(__dirname, "..", "front");
app.use(express.static(frontendPath));

// ✅ כל route שלא נמצא - מחזיר את index.html (ל־React)
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// 🟡 MongoDB connect + return app
const initApp = () => {
  return new Promise<Express>(async (resolve, reject) => {
    if (!process.env.DB_CONNECTION) {
      reject("DB_CONNECTION is not defined");
    } else {
      await mongoose.connect(process.env.DB_CONNECTION);
      resolve(app);
    }
  });
};

export default initApp;
