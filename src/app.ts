import appInit from "./server";
import dotenv from "dotenv";
dotenv.config();
const port = process.env.PORT;

const tmpFunc = async () => {
  const app = await appInit();
  app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
  });
};

tmpFunc();