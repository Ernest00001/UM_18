# PDF export font assets

All assets are licensed under the SIL Open Font License 1.1. Keep each matching license and this attribution file with redistributed assets. The Latin and Arabic binaries are unmodified. The CJK asset is a full static TrueType instance of the official Noto variable font, with glyph records aligned for fontkit compatibility.

Latin/Arabic retrieved or copied: 2026-10-13. TrueType CJK replacement derived and render-verified: 2026-10-14.

## Asset inventory

| File | Version | Bytes | Coverage | License |
| --- | --- | ---: | --- | --- |
| `NotoSans-Regular.ttf` | 2.008 | 569,208 | Nigerian/extended Latin, Greek, Cyrillic | `LICENSE-NotoSans.txt` |
| `NotoSans-Bold.ttf` | 2.008 | 575,740 | Nigerian/extended Latin, Greek, Cyrillic | `LICENSE-NotoSans.txt` |
| `NotoSansCJKsc-Regular.ttf` | 2.004, static weight 400 | 21,758,064 | Chinese Han, Japanese kana/kanji, Korean Hangul | `LICENSE-NotoSansCJK.txt` |
| `NotoSansArabic-Regular.ttf` | 2.010 | 250,880 | Arabic | `LICENSE-NotoSansArabic.txt` |

The CJK font uses Simplified Chinese glyph forms by default and retains the upstream Chinese, Japanese, and Korean code-point coverage. It preserves every upstream Unicode cmap entry and all glyphs; it is not a test-only character subset. Load it lazily when needed by an export. Characters absent from every available font must be handled explicitly by the application.

## Sources and attribution

### NotoSans-Regular.ttf

- Source: https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
- Attribution from font metadata: Copyright 2015-2021 Google LLC.
- Final asset SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`
- Best Unicode cmap entries verified with fontTools: 2,840.

### NotoSans-Bold.ttf

- Source: https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf
- Attribution from font metadata: Copyright 2015-2021 Google LLC.
- Final asset SHA-256: `c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a`
- Best Unicode cmap entries verified with fontTools: 2,840.

### NotoSansCJKsc-Regular.ttf

- Source: https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/NotoSansCJKsc-VF.ttf
- Attribution from font metadata: Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
- Final asset SHA-256: `cc40564c4acdffbbda43d6a75cda7db32365e6f76666d1cc5fca4f22c4c021b2`
- Best Unicode cmap entries verified with fontTools: 44,810.

### NotoSansArabic-Regular.ttf

- Source: Bundled Noto font copied from the LibreOffice runtime, unmodified; upstream project https://github.com/notofonts/arabic
- Attribution from font metadata: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/arabic).
- Final asset SHA-256: `d6efa4c9fac8ecefd2de19676acc3a396ba7aee99ba7a2d513950246841b6725`
- Best Unicode cmap entries verified with fontTools: 1,161.

License sources:
- Noto Sans: https://raw.githubusercontent.com/notofonts/noto-fonts/main/LICENSE
- Noto Sans CJK: https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE
- Noto Sans Arabic: https://raw.githubusercontent.com/notofonts/arabic/main/OFL.txt

## CJK derivation

- Original official TrueType variable source: `NotoSansCJKsc-VF.ttf`, 36,144,788 bytes.
- Original source SHA-256: `990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`.
- FontTools version: 4.61.1.
- Instantiated the only variable axis, `wght`, at 400 with `updateFontNames=True`, producing a static regular TrueType font. The output contains `glyf`/`loca` and no `fvar`, `gvar`, CFF, or CFF2 tables.
- Set `font["glyf"].padding = 4` before saving. This aligns every glyph record to a four-byte boundary without changing its contours, character mappings, or glyph IDs.
- Alignment is necessary because fontkit 1.1.1 may emit a short `loca` table for a small PDF subset. Short `loca` offsets are stored in two-byte units, so odd-byte glyph records from the upstream long-`loca` source were truncated and some glyphs rendered blank. Four-byte alignment fixes that compatibility issue.
- Retained all 65,535 glyphs and exactly the original 44,810 Unicode cmap entries. No glyph outline or character coverage was intentionally removed.
- Preserved font metadata and the family name `Noto Sans CJK SC`; the reserved name `Source` is not used as the derivative family name.

Reproduction of the transformation:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("NotoSansCJKsc-VF.ttf")
instantiateVariableFont(font, {"wght": 400}, inplace=True, updateFontNames=True)
font["glyf"].padding = 4
font.save("NotoSansCJKsc-Regular.ttf")
```

## Rendered PDF compatibility checks

Verified with fontTools 4.61.1, `@pdf-lib/fontkit` 1.1.1, `pdf-lib` 1.17.1, and actual Poppler `pdftoppm` rasterization at 144 DPI:

- Nigerian/extended Latin: `Ọlá Ṣẹ́gun | Àdébáyọ̀ Ìfẹ́ọlá | Ɓɓ Ɗɗ Ƙƙ | Ṅṅ Ịị Ọọ Ụụ`. Earlier code-point checks also included `Ŋŋ` and uppercase/lowercase Yoruba, Hausa, and Igbo forms.
- Chinese: `王小明 張偉 王曉明 陈雨 李雯`.
- Japanese: `山田太郎 鈴木 佐々木 あいうえお アイウエオ`.
- Korean: `김민수 이하늘 박서연 이지훈 최지우`.
- Rare/supplementary-plane name characters: `𠮷田 髙橋 﨑田`.
- Arabic: `محمد أحمد علي عبدالله`.
- A mixed font run containing Nigerian diacritics, `王小明`, and `김민수` rendered successfully on the same page.
- All four fonts were embedded using `{ subset: true }`; the specimen PDF was 27,459 bytes. `pdffonts` identified the CJK embedding as CID TrueType with an embedded font and a Unicode map.
- Visual inspection confirmed complete, legible glyphs. Pixel checks separately inspected all 52 non-space CJK glyph positions; each contained at least 222 dark pixels. Text extraction also retained every Latin/CJK specimen string, including supplementary-plane characters.
- The deprecated CFF OTF was retired because successful serialization alone did not establish correct Poppler rendering. The TrueType replacement is the supported CJK PDF-export asset.
- Application code remains responsible for fallback run selection, line wrapping, and bidirectional paragraph layout.

The CJK download is 21,758,064 bytes and should be loaded only when required. PDF exports subset the selected glyphs instead of embedding the complete asset.
