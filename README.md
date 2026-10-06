# Yuksalish Agro: interaktiv biznes-reja

Buxoro viloyati, Burgut qishlog'i yaqinidagi 49,4 gektar yerda (7-kontur bilan) 100 bosh naslli sigirli zamonaviy sut-go'sht fermasining biznes-rejasi.

## Qanday ochiladi

Ikki yo'l bor:

1. **Umumiy saqlash bilan (tavsiya etiladi).** Node.js 18 yoki undan yangisi kerak. Loyiha papkasida:

   ```sh
   npm start
   ```

   So'ng brauzerda http://localhost:8787 manzilini oching. "Saqlash" tugmasi ishlaydi, saqlangan versiyalar `server/data/versions/` papkasida turadi va sahifani ochgan hamma ko'radi. Serverga joylash (nginx, systemd, kalit so'z) `server/README.md` da yozilgan.
2. **Shunchaki fayl sifatida.** `index.html` ni brauzerda oching. Hisob-kitob to'liq ishlaydi, lekin "Saqlash" o'chiq turadi va o'zgarishlar faqat shu brauzerda qoladi. Internet faqat shriftlar uchun kerak.

## Nimalarni o'zgartirish mumkin

- Chap paneldagi barcha narx, ratsion, hosildorlik va kredit shartlari.
- 2-bo'limdagi karta: dalani bosib, maydoni va nima ekilishini o'zgartirish.
- 6-bo'lim (investitsiya) va 8-bo'lim (xodimlar) jadvallari.
- 7-bo'lim: zamonaviy texnologiyalarni (raqamli kuzatish, sut hisoblagichlari, ozuqani aniq taqsimlash, mikroiqlim, go'ng tozalash, buzoqlarni avtomatik boqish) yoqish yoki o'chirish.

"Saqlash" tugmasi bosilganda saqlovchining ismi va familiyasi so'raladi. Har bir versiya kim saqlagani, qachon saqlangani va nimalar o'zgargani bilan 14-bo'limda ("O'zgarishlar tarixi") ko'rinadi, istalgan versiyani qayta ochish mumkin. Tugma yonidagi yozuv saqlash hozir ishlayotgani yoki nima uchun ishlamayotganini aytib turadi. "Asl qiymatlar" tugmasi hammasini boshlang'ich holatga qaytaradi.

## VS Code'da Claude bilan davom ettirish

1. Papkani VS Code'da oching.
2. Claude loyiha haqidagi barcha ma'lumotni `CLAUDE.md` faylidan o'qiydi: biznes qarorlari, modelning tuzilishi, yozish qoidalari va ochiq savollar.
3. Modelni o'zgartirgandan keyin natijani terminalda tekshirish: `node tools/model-check.mjs`

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `index.html` | Butun biznes-reja (sahifa, hisob-kitob modeli, grafiklar) |
| `yer-xaritasi.jpg` | Interaktiv karta uchun yer rasmi |
| `ferma-rejasi.jpg` | Ferma rejasi namunasi |
| `tech-iot.jpg`, `silos-*.jpg` | Texnologiyalar va infratuzilma bo'limi rasmlari |
| `assets/plots.json` | Dalalar chegaralarining koordinatalari |
| `assets/original/` | Siz yuborgan asl rasmlar |
| `tools/model-check.mjs` | Modelni brauzersiz tekshirish skripti |
| `server/server.mjs` | Saqlash serveri (`npm start`); joylash yo'riqnomasi `server/README.md` da |
| `CLAUDE.md` | AI uchun loyiha tavsifi |
