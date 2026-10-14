import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.join(__dirname, "../pages/ClientsPage.jsx"), "utf8");
const bearerTemplate = ["Authorization: `Bearer ", "{token}`"].join("$");

test("health certificates use an authenticated response download, never a bearer token URL", () => {
  expect(source).toContain('responseType: "blob"');
  expect(source).toContain(bearerTemplate);
  expect(source).not.toContain("health-certificate.pdf?token=");
});
