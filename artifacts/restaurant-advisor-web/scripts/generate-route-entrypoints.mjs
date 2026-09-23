import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoutes = ["restaurants", "about", "contact"];
const outputDirectory = resolve("dist");

await Promise.all(
  publicRoutes.map(async (route) => {
    const routeDirectory = resolve(outputDirectory, route);
    await mkdir(routeDirectory, { recursive: true });
    await copyFile(
      resolve(outputDirectory, "index.html"),
      resolve(routeDirectory, "index.html")
    );
  })
);