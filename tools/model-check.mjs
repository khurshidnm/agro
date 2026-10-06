// Modelni brauzersiz tekshirish: node tools/model-check.mjs
// index.html ichidagi DEF ... run() qismini ajratib oladi va asosiy natijalarni chiqaradi.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("/* ------------------------- Default data");
const b = html.indexOf("/* ------------------------- Formatting");
if (a < 0 || b < 0) throw new Error("Model markerlari topilmadi");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + "\nthis.DEF = DEF; this.run = run;", ctx);
const R = ctx.run(JSON.parse(JSON.stringify(ctx.DEF)));
const b9 = x => (x / 1e9).toFixed(2);
console.log(`Investitsiya ${b9(R.total)} mlrd | kredit ${b9(R.loan)} | o'z mablag'i ${b9(R.equity)}`);
console.log(`Yer: jami ${R.totalHa} ga, ferma ${R.farmHa}, almashlab ${R.rotHa}, beda ${R.alfHa}`);
console.log("Yil   Sigir  Tushum  Xarajat  EBITDA  SofFoyda  Pul");
for (const y of R.yrs) console.log(`${y.year}  ${String(Math.round(y.end.cows)).padStart(5)}  ${b9(y.revTotal).padStart(6)}  ${b9(y.costTotal).padStart(7)}  ${b9(y.ebitda).padStart(6)}  ${b9(y.net).padStart(8)}  ${b9(y.cash).padStart(6)}`);
console.log(`O'rtacha sof foyda 2029–2036: ${b9(R.avgNet)} mlrd | eng past pul: ${b9(R.minCash)} | IRR: ${R.irr == null ? "—" : (R.irr * 100).toFixed(1) + "%"}`);
