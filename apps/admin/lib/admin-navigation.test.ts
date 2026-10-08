import test from "node:test";
import assert from "node:assert/strict";
import {adminNavGroups,visibleAdminGroups,adminCurrentItem,adminPathActive,adminSearchMatch} from "./admin-navigation";

test("all admin links are unique and categories have navigation",()=>{
 const links=adminNavGroups.flatMap(g=>g.items);
 assert.equal(new Set(links.map(l=>l.href)).size,links.length);
 assert.ok(links.length>=25);
 for(const href of ["/","/moderation","/listings","/users","/finance","/seo","/system","/categories"])assert.ok(links.some(l=>l.href===href),href);
});
test("moderator menu hides integration, financial and system administration",()=>{
 const paths=visibleAdminGroups(["MODERATOR"]).flatMap(g=>g.items.map(i=>i.href));
 for(const path of ["/finance","/integrations","/system","/audit","/commercial","/categories","/mobile-release"])assert.ok(!paths.includes(path),path);
 for(const path of ["/moderation","/listings","/dsa","/risk"])assert.ok(paths.includes(path),path);
});
test("support and finance employees see only relevant menu sections",()=>{
 const support=visibleAdminGroups(["SUPPORT"]).flatMap(g=>g.items.map(i=>i.href));
 assert.ok(support.includes("/inbox")&&support.includes("/support"));
 assert.ok(!support.includes("/seo")&&!support.includes("/settings"));
 const fin=visibleAdminGroups(["FINANCE"]).flatMap(g=>g.items.map(i=>i.href));
 assert.ok(fin.includes("/finance")&&fin.includes("/hbx-bookings"));
 assert.ok(!fin.includes("/integrations")&&!fin.includes("/mobile-ui"));
 assert.ok(!fin.includes("/listings")&&!fin.includes("/users"));
});
test("superadmin keeps all sections; detail routes select their parent",()=>{
 const all=adminNavGroups.flatMap(g=>g.items);
 assert.equal(visibleAdminGroups(["SUPER_ADMIN"]).flatMap(g=>g.items).length,all.length);
 assert.equal(adminCurrentItem("/listings/example123",visibleAdminGroups(["SUPER_ADMIN"]))?.href,"/listings");
 assert.equal(adminPathActive("/listings-extra","/listings"),false);
});
test("search accepts French accent-insensitive labels",()=>{
 assert.ok(adminSearchMatch("Modération","moderation"));
 assert.ok(adminSearchMatch("Catégories","CATEGORIE"));
 assert.ok(!adminSearchMatch("Utilisateurs","finance"));
});
