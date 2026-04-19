export function toRomanIfNeeded(text: any, enabled: any) {
  if (!enabled)
    return text;
  if (!/[\u0900-\u097F]/.test(text))
    return text;
  return transliterateDevanagariToRoman(text);
}
function transliterateDevanagariToRoman(input: any) {
  const independentVowels: Record<string, string> = {
    "\u0905": "a",
    "\u0906": "aa",
    "\u0907": "i",
    "\u0908": "ii",
    "\u0909": "u",
    "\u090A": "uu",
    "\u090B": "ri",
    "\u090F": "e",
    "\u0910": "ai",
    "\u0913": "o",
    "\u0914": "au"
  };
  const consonants: Record<string, string> = {
    "\u0915": "k",
    "\u0916": "kh",
    "\u0917": "g",
    "\u0918": "gh",
    "\u0919": "ng",
    "\u091A": "ch",
    "\u091B": "chh",
    "\u091C": "j",
    "\u091D": "jh",
    "\u091E": "ny",
    "\u091F": "t",
    "\u0920": "th",
    "\u0921": "d",
    "\u0922": "dh",
    "\u0923": "n",
    "\u0924": "t",
    "\u0925": "th",
    "\u0926": "d",
    "\u0927": "dh",
    "\u0928": "n",
    "\u092A": "p",
    "\u092B": "ph",
    "\u092C": "b",
    "\u092D": "bh",
    "\u092E": "m",
    "\u092F": "y",
    "\u0930": "r",
    "\u0932": "l",
    "\u0935": "v",
    "\u0936": "sh",
    "\u0937": "sh",
    "\u0938": "s",
    "\u0939": "h",
    "\u0933": "l",
    "\u0915\u094D\u0937": "ksh",
    "\u091C\u094D\u091E": "gy"
  };
  const matras: Record<string, string> = {
    "\u093E": "aa",
    "\u093F": "i",
    "\u0940": "ii",
    "\u0941": "u",
    "\u0942": "uu",
    "\u0943": "ri",
    "\u0947": "e",
    "\u0948": "ai",
    "\u094B": "o",
    "\u094C": "au"
  };
  const specials: Record<string, string> = {
    "\u0902": "n",
    "\u0901": "n",
    "\u0903": "h"
  };
  const virama = "\u094D";
  const chars: string[] = Array.from(input);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (independentVowels[ch]) {
      out += independentVowels[ch];
      continue;
    }
    if (specials[ch]) {
      out += specials[ch];
      continue;
    }
    if (consonants[ch]) {
      const base = consonants[ch];
      const next = chars[i + 1];
      if (next === virama) {
        out += base;
        i += 1;
        continue;
      }
      if (next && matras[next]) {
        out += `${base}${matras[next]}`;
        i += 1;
        continue;
      }
      out += `${base}a`;
      continue;
    }
    if (matras[ch]) {
      out += matras[ch];
      continue;
    }
    out += ch;
  }
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
