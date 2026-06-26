import { createApp } from "./app.js";
import { PORT } from "./lib/constants.js";

const app = createApp();

app.listen(Number(PORT), () => {
  console.log(`api-registry listening on http://localhost:${PORT}`);
});
