import { normalizeText } from './normalize.js';

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const HIRAGANA_OFFSET = 0x60;

const DIGRAPHS = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  うぁ: 'wa', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  てぃ: 'ti', とぅ: 'tu', でぃ: 'di', どぅ: 'du',
  ヴぁ: 'va', ヴぃ: 'vi', ヴぇ: 've', ヴぉ: 'vo',
};

const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'n',
  ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo',
};

const PHRASE_READINGS = {
  '千鳥': 'chidori',
  '東京': 'tokyo',
  '幽霊': 'yurei',
  '空想': 'kuso',
  '般若心経': 'hannyashingyo',
  '夜の踊り子': 'yoru no odoriko',
  '多分風': 'tabun kaze',
  '多分、風': 'tabun kaze',
  '忘れられないの': 'wasurerarenaino',
  '君がいればいい': 'kimi ga ireba ii',
};

const KANJI_READINGS = {
  俺: 'ore',
  悪: 'waru',
  夜: 'yoru',
  踊: 'odori',
  子: 'ko',
  多: 'ta',
  分: 'bun',
  風: 'kaze',
  忘: 'wasure',
  千: 'chi',
  鳥: 'dori',
  幽: 'yu',
  霊: 'rei',
  東: 'to',
  京: 'kyo',
  空: 'ku',
  想: 'so',
  森: 'mori',
  般: 'han',
  若: 'nya',
  心: 'shin',
  経: 'gyo',
  君: 'kimi',
  月: 'tsuki',
  花: 'hana',
  火: 'hi',
  水: 'mizu',
  木: 'ki',
  金: 'kin',
  土: 'do',
  日: 'hi',
  人: 'hito',
  星: 'hoshi',
  雨: 'ame',
  雲: 'kumo',
  夢: 'yume',
  音: 'oto',
  歌: 'uta',
  恋: 'koi',
  愛: 'ai',
};

const CJK_FOLD = {
  東: '东', 詞: '词', 體: '体', 鱼: '鱼', 魚: '鱼', 韻: '韵',
  樂: '乐', 歌: '歌', 櫻: '樱', 桜: '樱', 國: '国', 國: '国',
  風: '风', 雲: '云', 門: '门', 間: '间', 長: '长', 錦: '锦',
  麗: '丽', 龍: '龙', 鳥: '鸟', 馬: '马', 貝: '贝', 見: '见',
  電: '电', 車: '车', 書: '书', 時: '时', 後: '后', 會: '会',
  語: '语', 説: '说', 話: '话', 聲: '声', 寫: '写', 無: '无',
  萬: '万', 與: '与', 來: '来', 對: '对', 開: '开', 關: '关',
  夢: '梦', 淚: '泪', 裡: '里', 這: '这', 那: '那', 為: '为',
  產: '产', 廣: '广', 廳: '厅', 室: '室', 團: '团', 傑: '杰',
  倫: '伦', 羅: '罗', 義: '义', 華: '华', 藝: '艺', 術: '术',
  惠: '惠', 恵: '惠', 實: '实', 須: '须', 彥: '彦', 彦: '彦',
};

const variantCache = new Map();

export function matchingTextVariants(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const cached = variantCache.get(raw);
  if (cached) return cached;

  const variants = [
    normalizeText(raw, { stripVersion: true }),
    normalizeText(foldCjk(raw), { stripVersion: true }),
    compactReading(raw),
    compactReading(foldCjk(raw)),
    ...latinReadingVariants(raw),
    ...kanaReadingVariants(raw),
  ];

  const result = unique(variants
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 2));
  if (variantCache.size > 10000) variantCache.clear();
  variantCache.set(raw, result);
  return result;
}

export function foldCjk(value) {
  return String(value || '').replace(/[\u3400-\u9fff]/g, (char) => CJK_FOLD[char] || char);
}

export function romanizeKana(value) {
  const text = toHiragana(String(value || ''));
  let result = '';
  let doubleNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === 'っ') {
      doubleNext = true;
      continue;
    }
    if (char === 'ー') {
      result += lastVowel(result);
      continue;
    }

    const pair = text.slice(index, index + 2);
    let roma = DIGRAPHS[pair];
    if (roma) {
      index += 1;
    } else {
      roma = KANA[char];
    }

    if (!roma) {
      result += char;
      doubleNext = false;
      continue;
    }

    if (doubleNext && /^[bcdfghjklmnpqrstvwxyz]/.test(roma)) {
      result += roma[0];
    }
    result += roma;
    doubleNext = false;
  }

  return result;
}

function kanaReadingVariants(value) {
  const text = String(value || '');
  if (!/[\u3040-\u30ff]/.test(text)) return [];
  const literal = romanizeMixedJapanese(text);
  const particle = romanizeMixedJapanese(text
    .replace(/は/g, 'わ')
    .replace(/へ/g, 'え')
    .replace(/を/g, 'お'));
  return [compactReading(literal), compactReading(particle)];
}

function romanizeMixedJapanese(value) {
  let text = String(value || '');
  for (const [phrase, reading] of Object.entries(PHRASE_READINGS).sort((a, b) => b[0].length - a[0].length)) {
    text = text.replaceAll(phrase, ` ${reading} `);
  }

  let result = '';
  let kanaBuffer = '';
  const flushKana = () => {
    if (!kanaBuffer) return;
    result += romanizeKana(kanaBuffer);
    kanaBuffer = '';
  };

  for (const char of text) {
    if (/[\u3040-\u30ff]/.test(char)) {
      kanaBuffer += char;
    } else if (KANJI_READINGS[char]) {
      flushKana();
      result += ` ${KANJI_READINGS[char]} `;
    } else {
      flushKana();
      result += char;
    }
  }
  flushKana();
  return result;
}

function latinReadingVariants(value) {
  const compact = compactReading(value);
  const noLongVowels = compact
    .replace(/ou/g, 'o')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/ii/g, 'i')
    .replace(/ee/g, 'e');
  return [compact, noLongVowels];
}

function compactReading(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ōŌ]/g, 'o')
    .replace(/[ūŪ]/g, 'u')
    .replace(/[āĀ]/g, 'a')
    .replace(/[īĪ]/g, 'i')
    .replace(/[ēĒ]/g, 'e')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '');
  return foldDiacritics(romanizeMixedJapanese(text))
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function toHiragana(value) {
  return String(value || '').replace(/[\u30a1-\u30f6]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code < KATAKANA_START || code > KATAKANA_END) return char;
    return String.fromCharCode(code - HIRAGANA_OFFSET);
  });
}

function lastVowel(value) {
  const match = String(value || '').match(/[aeiou](?!.*[aeiou])/);
  return match?.[0] || '';
}

function foldDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
