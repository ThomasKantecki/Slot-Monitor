// The Orlando Health directory records parse into providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toRoster } from "../src/sources/directory.js";

test("Orlando Health records take their headshot from the index and repair street-in-name offices", () => {
  const hit = { isEmployed: true, npi: "1234567890", fullName: "Rudhir Tandon, MD", title: "MD", slug: "rudhir-tandon-md", specialties: [{ name: "Interventional Cardiology" }],
    media: "https://orlandohealth.getbynder.com/transform/Physician_Headshot/abc/Rudhir_Tandon",
    locations: [{ name: "1222 S Orange Ave", address1: "", address2: "", city: "Orlando", state: "FL", zipCode: "32806", isPrimary: true }, { name: "Heart Institute", address1: "1222 S Orange Ave", address2: "Suite 2", city: "Orlando", state: "FL", zipCode: "32806", isPrimary: false }] };
  const [person] = toRoster({ hits: [hit] }, []);
  assert.equal(person.photo, hit.media);
  assert.deepEqual(person.locations.map((l) => [l.name, l.addr]), [["", "1222 S Orange Ave"], ["Heart Institute", "1222 S Orange Ave, Suite 2"]]);
  const [withScrape] = toRoster({ hits: [{ ...hit, media: undefined }] }, [{ slug: "rudhir-tandon-md", photo: "https://scrape/photo.jpg" }]);
  assert.equal(withScrape.photo, "https://scrape/photo.jpg", "the browser capture still fills in when the index has no headshot");
});
