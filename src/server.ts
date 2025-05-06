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

const app = express();

// ✅ הגשת קבצי פרונט מהתיקייה ../front (חייב לבוא לפני הראוטים האחרים)
const frontendPath = path.join(__dirname, "..", "front");
app.use(express.static(frontendPath));

// ✅ כל ראוט שלא נמצא - מחזיר את index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

//Session Middleware
app.use(
  session({
    secret: "some_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// CORS
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// הגדרות CORS נוספות
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

// ראוטים
app.use("/auth", authController);
app.use("/auth/lichess", lichessRouter);
app.use("/api/lichess", lichessRouter);
app.use(lichessRouter);

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
const specs = swaggerJsDoc(options);
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(specs));

// MongoDB connect + return app
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
