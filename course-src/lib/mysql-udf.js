// MySQL built-in functions implemented as SQLite user-defined functions (sql.js).
// Plain script: attaches `MySQLFunctions` to globalThis.
(function (root) {
  'use strict';

  // ---------- value coercion (MySQL-ish) ----------
  function toStr(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(15));
    if (v instanceof Uint8Array) return new TextDecoder().decode(v);
    return String(v);
  }
  function toNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(toStr(v));
    return m ? Number(m[0]) : 0;
  }
  const toInt = (v) => (v === null || v === undefined ? null : Math.round(toNum(v)));
  const anyNull = (args) => args.some((a) => a === null || a === undefined);
  const chars = (s) => Array.from(s);

  // ---------- dates ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');

  // days since 1970-01-01 (proleptic Gregorian), Howard Hinnant's algorithm
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function civilFromDays(z) {
    z += 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
  }
  const TO_DAYS_OFFSET = 719528; // MySQL TO_DAYS('1970-01-01')

  // Parse a MySQL date/datetime value. Returns null when invalid (MySQL returns NULL).
  function parseDT(v) {
    if (v === null || v === undefined) return null;
    let s = typeof v === 'number' ? String(Math.trunc(v)) : toStr(v).trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,6}))?)?)?$/.exec(s);
    if (!m) {
      const c = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(s);
      if (!c) return null;
      m = [s, c[1], c[2], c[3], c[4], c[5], c[6]];
    }
    const y = +m[1], mo = +m[2], d = +m[3];
    const h = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, sec = m[6] ? +m[6] : 0;
    const us = m[7] ? +(m[7] + '000000').slice(0, 6) : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || sec > 59) return null;
    return { y, mo, d, h, mi, s: sec, us, hasTime: m[4] !== undefined };
  }
  const epochDays = (t) => daysFromCivil(t.y, t.mo, t.d);
  const fmtDate = (y, mo, d) => `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}`;
  function fmtDT(t, forceTime) {
    const date = fmtDate(t.y, t.mo, t.d);
    if (!t.hasTime && !forceTime) return date;
    return `${date} ${pad(t.h)}:${pad(t.mi)}:${pad(t.s)}${t.us ? '.' + pad(t.us, 6) : ''}`;
  }
  function fromSeconds(totalSec, us, hasTime) {
    const days = Math.floor(totalSec / 86400);
    const rem = totalSec - days * 86400;
    const c = civilFromDays(days);
    return { y: c.y, mo: c.m, d: c.d, h: Math.floor(rem / 3600), mi: Math.floor((rem % 3600) / 60), s: rem % 60, us: us || 0, hasTime };
  }
  const toSeconds = (t) => epochDays(t) * 86400 + t.h * 3600 + t.mi * 60 + t.s;

  // Port of MySQL's calc_daynr / calc_weekday / calc_week (sql/sql_time.cc)
  const calcDaynr = (y, m, d) => daysFromCivil(y, m, d) + TO_DAYS_OFFSET;
  const calcWeekday = (daynr, sundayFirst) => (daynr + 5 + (sundayFirst ? 1 : 0)) % 7;
  const WEEK_MONDAY_FIRST = 1, WEEK_YEAR = 2, WEEK_FIRST_WEEKDAY = 4;
  function calcWeek(t, behaviour) {
    let daynr = calcDaynr(t.y, t.mo, t.d);
    let firstDaynr = calcDaynr(t.y, 1, 1);
    const mondayFirst = !!(behaviour & WEEK_MONDAY_FIRST);
    let weekYear = !!(behaviour & WEEK_YEAR);
    const firstWeekday = !!(behaviour & WEEK_FIRST_WEEKDAY);
    let weekday = calcWeekday(firstDaynr, !mondayFirst);
    let year = t.y;
    let days;
    if (t.mo === 1 && t.d <= 7 - weekday) {
      if (!weekYear && ((firstWeekday && weekday !== 0) || (!firstWeekday && weekday >= 4))) return { week: 0, year };
      weekYear = true;
      year--;
      days = isLeap(year) ? 366 : 365;
      firstDaynr -= days;
      weekday = (weekday + 53 * 7 - days) % 7;
    }
    if ((firstWeekday && weekday !== 0) || (!firstWeekday && weekday >= 4)) days = daynr - (firstDaynr + (7 - weekday));
    else days = daynr - (firstDaynr - weekday);
    if (weekYear && days >= 52 * 7) {
      weekday = (weekday + (isLeap(year) ? 366 : 365)) % 7;
      if ((!firstWeekday && weekday < 4) || (firstWeekday && weekday === 0)) return { week: 1, year: year + 1 };
    }
    return { week: Math.floor(days / 7) + 1, year };
  }
  function weekMode(mode) {
    let f = mode & 7;
    if (!(f & WEEK_MONDAY_FIRST)) f ^= WEEK_FIRST_WEEKDAY;
    return f;
  }
  const dayOfWeek1 = (t) => calcWeekday(calcDaynr(t.y, t.mo, t.d), true) + 1; // 1 = Sunday
  const weekday0 = (t) => calcWeekday(calcDaynr(t.y, t.mo, t.d), false); // 0 = Monday
  const dayOfYear = (t) => epochDays(t) - daysFromCivil(t.y, 1, 1) + 1;
  const ordinal = (n) => {
    const r100 = n % 100;
    if (r100 >= 11 && r100 <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  };

  function dateFormat(v, fmt, timeOnly) {
    if (v === null || fmt === null) return null;
    let t;
    if (timeOnly) {
      const tm = parseTime(v);
      if (!tm) return null;
      t = { y: 0, mo: 0, d: 0, h: tm.h, mi: tm.mi, s: tm.s, us: 0 };
    } else {
      t = parseDT(v);
      if (!t) return null;
    }
    const f = toStr(fmt);
    let out = '';
    for (let i = 0; i < f.length; i++) {
      if (f[i] !== '%' || i === f.length - 1) { out += f[i]; continue; }
      const c = f[++i];
      const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
      switch (c) {
        case 'a': out += DAYS[dayOfWeek1(t) - 1].slice(0, 3); break;
        case 'b': out += MONTHS[t.mo - 1].slice(0, 3); break;
        case 'c': out += t.mo; break;
        case 'D': out += ordinal(t.d); break;
        case 'd': out += pad(t.d); break;
        case 'e': out += t.d; break;
        case 'f': out += pad(t.us, 6); break;
        case 'H': out += pad(t.h); break;
        case 'h': case 'I': out += pad(h12); break;
        case 'i': out += pad(t.mi); break;
        case 'j': out += pad(dayOfYear(t), 3); break;
        case 'k': out += t.h; break;
        case 'l': out += h12; break;
        case 'M': out += MONTHS[t.mo - 1]; break;
        case 'm': out += pad(t.mo); break;
        case 'p': out += t.h < 12 ? 'AM' : 'PM'; break;
        case 'r': out += `${pad(h12)}:${pad(t.mi)}:${pad(t.s)} ${t.h < 12 ? 'AM' : 'PM'}`; break;
        case 'S': case 's': out += pad(t.s); break;
        case 'T': out += `${pad(t.h)}:${pad(t.mi)}:${pad(t.s)}`; break;
        case 'U': out += pad(calcWeek(t, WEEK_FIRST_WEEKDAY).week); break;
        case 'u': out += pad(calcWeek(t, WEEK_MONDAY_FIRST).week); break;
        case 'V': out += pad(calcWeek(t, WEEK_YEAR | WEEK_FIRST_WEEKDAY).week); break;
        case 'v': out += pad(calcWeek(t, WEEK_YEAR | WEEK_MONDAY_FIRST).week); break;
        case 'W': out += DAYS[dayOfWeek1(t) - 1]; break;
        case 'w': out += dayOfWeek1(t) - 1; break;
        case 'X': out += pad(calcWeek(t, WEEK_YEAR | WEEK_FIRST_WEEKDAY).year, 4); break;
        case 'x': out += pad(calcWeek(t, WEEK_YEAR | WEEK_MONDAY_FIRST).year, 4); break;
        case 'Y': out += pad(t.y, 4); break;
        case 'y': out += pad(t.y % 100); break;
        default: out += c;
      }
    }
    return out;
  }

  function strToDate(str, fmt) {
    if (str === null || fmt === null) return null;
    const s = toStr(str), f = toStr(fmt);
    let i = 0;
    const r = { y: 0, mo: 1, d: 1, h: 0, mi: 0, s: 0, pm: null, hasTime: false, hasDate: false };
    const num = (min, max) => {
      const m = new RegExp(`^\\d{${min},${max}}`).exec(s.slice(i));
      if (!m) throw 0;
      i += m[0].length;
      return +m[0];
    };
    const name = (list, len) => {
      const rest = s.slice(i).toLowerCase();
      const idx = list.findIndex((n) => rest.startsWith((len ? n.slice(0, len) : n).toLowerCase()));
      if (idx < 0) throw 0;
      i += len || list[idx].length;
      return idx;
    };
    try {
      for (let k = 0; k < f.length; k++) {
        if (f[k] !== '%') {
          if (/\s/.test(f[k])) { while (/\s/.test(s[i] || '')) i++; continue; }
          if (s[i] !== f[k]) throw 0;
          i++;
          continue;
        }
        const c = f[++k];
        switch (c) {
          case 'Y': r.y = num(4, 4); r.hasDate = true; break;
          case 'y': { const y = num(2, 2); r.y = y < 70 ? 2000 + y : 1900 + y; r.hasDate = true; break; }
          case 'm': case 'c': r.mo = num(1, 2); r.hasDate = true; break;
          case 'd': case 'e': r.d = num(1, 2); r.hasDate = true; break;
          case 'D': r.d = num(1, 2); i += 2; r.hasDate = true; break;
          case 'M': r.mo = name(MONTHS) + 1; r.hasDate = true; break;
          case 'b': r.mo = name(MONTHS, 3) + 1; r.hasDate = true; break;
          case 'W': name(DAYS); break;
          case 'a': name(DAYS, 3); break;
          case 'H': case 'k': r.h = num(1, 2); r.hasTime = true; break;
          case 'h': case 'I': case 'l': r.h = num(1, 2); r.hasTime = true; break;
          case 'i': r.mi = num(1, 2); r.hasTime = true; break;
          case 's': case 'S': r.s = num(1, 2); r.hasTime = true; break;
          case 'f': num(1, 6); break;
          case 'p': { const p = s.slice(i, i + 2).toUpperCase(); if (p !== 'AM' && p !== 'PM') throw 0; r.pm = p === 'PM'; i += 2; break; }
          case 'T': r.h = num(1, 2); if (s[i++] !== ':') throw 0; r.mi = num(1, 2); if (s[i++] !== ':') throw 0; r.s = num(1, 2); r.hasTime = true; break;
          case '%': if (s[i++] !== '%') throw 0; break;
          default: if (s[i++] !== c) throw 0;
        }
      }
    } catch (e) {
      return null;
    }
    if (r.pm !== null) { if (r.h === 12) r.h = 0; if (r.pm) r.h += 12; }
    if (r.hasDate && (r.mo < 1 || r.mo > 12 || r.d < 1 || r.d > daysInMonth(r.y, r.mo))) return null;
    const t = { y: r.y, mo: r.mo, d: r.d, h: r.h, mi: r.mi, s: r.s, us: 0, hasTime: r.hasTime };
    if (!r.hasDate) return `${pad(r.h)}:${pad(r.mi)}:${pad(r.s)}`;
    return fmtDT(t);
  }

  // TIME values: 'HH:MM:SS' (hours may exceed 24, may be negative)
  function parseTime(v) {
    if (v === null || v === undefined) return null;
    const dt = parseDT(v);
    if (dt) return { neg: false, h: dt.h, mi: dt.mi, s: dt.s };
    const m = /^\s*(-)?(\d+):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?\s*$/.exec(toStr(v));
    if (!m) return null;
    return { neg: !!m[1], h: +m[2], mi: +m[3], s: m[4] ? +m[4] : 0 };
  }
  const timeToSec = (t) => (t.neg ? -1 : 1) * (t.h * 3600 + t.mi * 60 + t.s);
  function secToTime(sec) {
    const neg = sec < 0;
    sec = Math.abs(Math.trunc(sec));
    return `${neg ? '-' : ''}${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
  }

  // ---------- intervals ----------
  const IV = '\u0001IV:';
  const IV_SEP = '\u0002';
  const UNITS = ['MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR',
    'SECOND_MICROSECOND', 'MINUTE_MICROSECOND', 'MINUTE_SECOND', 'HOUR_MICROSECOND', 'HOUR_SECOND', 'HOUR_MINUTE',
    'DAY_MICROSECOND', 'DAY_SECOND', 'DAY_MINUTE', 'DAY_HOUR', 'YEAR_MONTH'];

  // -> { months, seconds, us } or null
  function intervalParts(amount, unit) {
    if (amount === null || amount === undefined) return null;
    unit = String(unit).toUpperCase();
    if (!unit.includes('_')) {
      const n = toNum(amount);
      const k = unit === 'MICROSECOND' ? n : Math.round(n);
      switch (unit) {
        case 'MICROSECOND': return { months: 0, seconds: Math.trunc(k / 1e6), us: k % 1e6 };
        case 'SECOND': return { months: 0, seconds: k, us: 0 };
        case 'MINUTE': return { months: 0, seconds: k * 60, us: 0 };
        case 'HOUR': return { months: 0, seconds: k * 3600, us: 0 };
        case 'DAY': return { months: 0, seconds: k * 86400, us: 0 };
        case 'WEEK': return { months: 0, seconds: k * 7 * 86400, us: 0 };
        case 'MONTH': return { months: k, seconds: 0, us: 0 };
        case 'QUARTER': return { months: k * 3, seconds: 0, us: 0 };
        case 'YEAR': return { months: k * 12, seconds: 0, us: 0 };
        default: return null;
      }
    }
    const s = toStr(amount).trim();
    const neg = s.startsWith('-');
    const nums = s.replace(/^-/, '').split(/[^0-9]+/).filter((x) => x !== '').map(Number);
    const fields = unit.split('_');
    const order = ['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND'];
    const from = order.indexOf(fields[0]), to = order.indexOf(fields[1]);
    const names = order.slice(from, to + 1);
    while (nums.length < names.length) nums.unshift(0);
    const part = {};
    names.forEach((nm, i) => { part[nm] = nums[i]; });
    const sign = neg ? -1 : 1;
    return {
      months: sign * ((part.YEAR || 0) * 12 + (part.MONTH || 0)),
      seconds: sign * ((part.DAY || 0) * 86400 + (part.HOUR || 0) * 3600 + (part.MINUTE || 0) * 60 + (part.SECOND || 0)),
      us: sign * (part.MICROSECOND || 0),
    };
  }

  function dateAdd(d, iv, sign) {
    if (d === null || iv === null) return null;
    const t = parseDT(d);
    if (!t) return null;
    let parts, unit;
    if (typeof iv === 'string' && iv.startsWith(IV)) {
      const cut = iv.lastIndexOf(IV_SEP);
      unit = iv.slice(cut + 1);
      parts = intervalParts(iv.slice(IV.length, cut), unit);
    } else {
      unit = 'DAY';
      parts = intervalParts(iv, 'DAY');
    }
    if (!parts) return null;
    const months = sign * parts.months, seconds = sign * parts.seconds, us = sign * parts.us;
    let r = { ...t };
    if (months) {
      const total = r.y * 12 + (r.mo - 1) + months;
      r.y = Math.floor(total / 12);
      r.mo = (total % 12 + 12) % 12 + 1;
      r.d = Math.min(r.d, daysInMonth(r.y, r.mo));
    }
    const timeUnit = /HOUR|MINUTE|SECOND/.test(unit);
    if (seconds || us) {
      let totalUs = r.us + us;
      let carry = Math.floor(totalUs / 1e6);
      totalUs -= carry * 1e6;
      r = fromSeconds(toSeconds(r) + seconds + carry, totalUs, r.hasTime || timeUnit);
    }
    r.hasTime = t.hasTime || timeUnit;
    if (r.y < 0 || r.y > 9999) return null;
    return fmtDT(r);
  }

  function timestampDiff(unit, a, b) {
    if (unit === null || a === null || b === null) return null;
    const ta = parseDT(a), tb = parseDT(b);
    if (!ta || !tb) return null;
    unit = String(unit).toUpperCase().replace(/^SQL_TSI_/, '');
    if (['MONTH', 'QUARTER', 'YEAR'].includes(unit)) {
      let months = (tb.y - ta.y) * 12 + (tb.mo - ta.mo);
      const restA = ((ta.d * 24 + ta.h) * 60 + ta.mi) * 60 + ta.s + ta.us / 1e6;
      const restB = ((tb.d * 24 + tb.h) * 60 + tb.mi) * 60 + tb.s + tb.us / 1e6;
      if (months > 0 && restB < restA) months--;
      else if (months < 0 && restB > restA) months++;
      return unit === 'MONTH' ? months : Math.trunc(months / (unit === 'YEAR' ? 12 : 3));
    }
    const diffSec = toSeconds(tb) - toSeconds(ta);
    const diffUs = diffSec * 1e6 + (tb.us - ta.us);
    const per = { MICROSECOND: 1, SECOND: 1e6, MINUTE: 60e6, HOUR: 3600e6, DAY: 86400e6, WEEK: 604800e6 }[unit];
    if (!per) throw new Error(`Unsupported unit ${unit} in TIMESTAMPDIFF`);
    return Math.trunc(diffUs / per);
  }

  function extract(unit, d) {
    if (d === null) return null;
    unit = String(unit).toUpperCase();
    const t = parseDT(d);
    const tm = t || parseTime(d);
    if (!tm) return null;
    switch (unit) {
      case 'YEAR': return t ? t.y : null;
      case 'MONTH': return t ? t.mo : null;
      case 'DAY': return t ? t.d : null;
      case 'QUARTER': return t ? Math.ceil(t.mo / 3) : null;
      case 'WEEK': return t ? calcWeek(t, weekMode(0)).week : null;
      case 'HOUR': return tm.h;
      case 'MINUTE': return tm.mi;
      case 'SECOND': return tm.s;
      case 'MICROSECOND': return t ? t.us : 0;
      case 'YEAR_MONTH': return t ? t.y * 100 + t.mo : null;
      case 'DAY_HOUR': return t ? t.d * 100 + t.h : null;
      case 'HOUR_MINUTE': return tm.h * 100 + tm.mi;
      case 'MINUTE_SECOND': return tm.mi * 100 + tm.s;
      default: throw new Error(`Unsupported unit ${unit} in EXTRACT`);
    }
  }

  function nowParts(utc) {
    const n = new Date();
    return utc
      ? { y: n.getUTCFullYear(), mo: n.getUTCMonth() + 1, d: n.getUTCDate(), h: n.getUTCHours(), mi: n.getUTCMinutes(), s: n.getUTCSeconds(), us: 0, hasTime: true }
      : { y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(), h: n.getHours(), mi: n.getMinutes(), s: n.getSeconds(), us: 0, hasTime: true };
  }

  // ---------- numbers ----------
  function shiftRound(x, d, fn) {
    if (x === null || d === null) return null;
    x = toNum(x);
    d = Math.trunc(toNum(d));
    if (!isFinite(x)) return x;
    const sign = x < 0 ? -1 : 1;
    const clean = String(+Math.abs(x).toPrecision(15));
    if (/e/i.test(clean)) return (sign * fn(Math.abs(x) * 10 ** d)) / 10 ** d;
    const shifted = Number(clean + 'e' + d);
    const r = fn(shifted);
    const out = sign * Number(r + 'e' + -d);
    return out === 0 ? 0 : out;
  }
  const mysqlRound = (x, d) => shiftRound(x, d == null ? 0 : d, Math.round);
  const mysqlTruncate = (x, d) => shiftRound(x, d, Math.trunc);

  function formatNumber(x, d) {
    if (x === null || d === null) return null;
    d = Math.max(0, Math.trunc(toNum(d)));
    const r = mysqlRound(x, d);
    const [ip, fp] = Math.abs(r).toFixed(d).split('.');
    const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (r < 0 ? '-' : '') + grouped + (d > 0 ? '.' + fp : '');
  }

  // ---------- strings ----------
  const simpleCase = (s, up) =>
    chars(s).map((ch) => {
      const c = up ? ch.toUpperCase() : ch.toLowerCase();
      return Array.from(c).length === 1 ? c : ch;
    }).join('');
  function mysqlSubstring(s, pos, len, hasLen) {
    if (s === null || pos === null || (hasLen && len === null)) return null;
    const cs = chars(toStr(s));
    pos = toInt(pos);
    if (pos === 0 || Math.abs(pos) > cs.length) return '';
    const start = pos > 0 ? pos - 1 : cs.length + pos;
    if (!hasLen) return cs.slice(start).join('');
    len = toInt(len);
    if (len <= 0) return '';
    return cs.slice(start, start + len).join('');
  }
  function substringIndex(s, delim, count) {
    if (anyNull([s, delim, count])) return null;
    s = toStr(s); delim = toStr(delim); count = toInt(count);
    if (count === 0 || delim === '') return '';
    const parts = s.split(delim);
    if (count > 0) return parts.slice(0, count).join(delim);
    return parts.slice(Math.max(parts.length + count, 0)).join(delim);
  }
  function locate(sub, s, pos) {
    if (sub === null || s === null) return null;
    const hay = chars(simpleCase(toStr(s), false));
    const needle = chars(simpleCase(toStr(sub), false));
    const start = pos === undefined ? 1 : toInt(pos);
    if (start < 1) return 0;
    outer: for (let i = start - 1; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i + 1;
    }
    return 0;
  }
  function pad3(s, len, padStr, left) {
    if (anyNull([s, len, padStr])) return null;
    const cs = chars(toStr(s)); len = toInt(len);
    const p = chars(toStr(padStr));
    if (len < 0) return null;
    if (cs.length >= len) return cs.slice(0, len).join('');
    if (!p.length) return null;
    const need = len - cs.length;
    let fill = '';
    for (let i = 0; i < need; i++) fill += p[i % p.length];
    return left ? fill + cs.join('') : cs.join('') + fill;
  }
  function mysqlTrim(mode, rem, s) {
    if (s === null) return null;
    s = toStr(s);
    const r = rem === null || rem === undefined ? ' ' : toStr(rem);
    if (r === '') return s;
    mode = String(mode).toUpperCase();
    if (mode === 'BOTH' || mode === 'LEADING') while (s.startsWith(r)) s = s.slice(r.length);
    if (mode === 'BOTH' || mode === 'TRAILING') while (s.endsWith(r)) s = s.slice(0, s.length - r.length);
    return s;
  }

  // ---------- regex ----------
  const CS = '\u0001CS\u0001';
  const POSIX = { alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t',
    punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e' };
  const reCache = new Map();
  function toRegExp(pattern, flags) {
    const key = pattern + '\u0000' + flags;
    let re = reCache.get(key);
    if (re) return re;
    const src = pattern
      .replace(/\[\[:<:\]\]|\[\[:>:\]\]/g, '\\b')
      .replace(/\[:(\w+):\]/g, (m, n) => POSIX[n] || m);
    try {
      re = new RegExp(src, flags);
    } catch (e) {
      throw new Error(`Invalid regular expression '${pattern}': ${e.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, '')}`);
    }
    if (reCache.size > 500) reCache.clear();
    reCache.set(key, re);
    return re;
  }
  function regexFlags(matchType, pattern) {
    let ci = !(typeof pattern === 'string' && pattern.startsWith(CS));
    let extra = '';
    for (const c of matchType ? toStr(matchType) : '') {
      if (c === 'c') ci = false;
      else if (c === 'i') ci = true;
      else if (c === 'm') extra += 'm';
      else if (c === 'n') extra += 's';
    }
    return (ci ? 'i' : '') + extra;
  }
  const stripCS = (p) => (p.startsWith(CS) ? p.slice(CS.length) : p);
  function regexpLike(s, pattern, matchType) {
    if (s === null || pattern === null) return null;
    const p = toStr(pattern);
    return toRegExp(stripCS(p), regexFlags(matchType, p)).test(toStr(s)) ? 1 : 0;
  }
  function regexpReplace(s, pattern, repl, pos, occ, matchType) {
    if (anyNull([s, pattern, repl])) return null;
    const p = toStr(pattern);
    const str = toStr(s);
    const start = pos == null ? 1 : toInt(pos);
    const occurrence = occ == null ? 0 : toInt(occ);
    const re = toRegExp(stripCS(p), regexFlags(matchType, p) + 'g');
    const head = str.slice(0, start - 1), tail = str.slice(start - 1);
    let n = 0;
    return head + tail.replace(re, (...m) => {
      n++;
      if (occurrence && n !== occurrence) return m[0];
      const groups = m.slice(1, typeof m[m.length - 1] === 'object' ? -3 : -2);
      return toStr(repl).replace(/\$(\d)/g, (x, g) => (g === '0' ? m[0] : groups[+g - 1] ?? ''));
    });
  }
  function regexpMatches(s, pattern, pos, matchType) {
    const p = toStr(pattern);
    const str = toStr(s);
    const start = pos == null ? 1 : toInt(pos);
    const re = toRegExp(stripCS(p), regexFlags(matchType, p) + 'g');
    re.lastIndex = start - 1;
    const out = [];
    let m;
    while ((m = re.exec(str))) { out.push(m); if (m[0] === '') re.lastIndex++; }
    return out;
  }

  // ---------- helpers for registration ----------
  function variadic(fn) {
    Object.defineProperty(fn, 'length', { value: -1 });
    return fn;
  }
  // sql.js passes whatever a function throws to sqlite3_result_error as a C string, so an Error
  // object arrives as an empty message: rethrow its text instead.
  function arity(name, min, max, fn) {
    return variadic((...a) => {
      if (a.length < min || a.length > max) {
        throw `Incorrect parameter count in the call to native function '${name.toUpperCase()}'`;
      }
      try {
        return fn(...a);
      } catch (e) {
        throw e instanceof Error ? e.message : String(e);
      }
    });
  }
  const dt1 = (fn) => (d) => { const t = parseDT(d); return t ? fn(t) : null; };
  const math1 = (fn) => (x) => (x === null ? null : fn(toNum(x)));

  const scalars = {
    // dates
    datediff: [2, 2, (a, b) => { const ta = parseDT(a), tb = parseDT(b); return ta && tb ? epochDays(ta) - epochDays(tb) : null; }],
    date_add: [2, 2, (d, iv) => dateAdd(d, iv, 1)],
    date_sub: [2, 2, (d, iv) => dateAdd(d, iv, -1)],
    adddate: [2, 2, (d, iv) => dateAdd(d, iv, 1)],
    subdate: [2, 2, (d, iv) => dateAdd(d, iv, -1)],
    mysql_interval: [2, 2, (n, unit) => (n === null ? null : `${IV}${toStr(n)}${IV_SEP}${unit}`)],
    // a DATE / DATETIME / TIME in arithmetic becomes a number in MySQL: 20240131, 20240131093000, 93000
    mysql_datenum: [1, 1, (v) => {
      if (v === null || typeof v === 'number') return v;
      const s = toStr(v).trim();
      const tm = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s);
      if (tm) return +tm[1] * 10000 + +tm[2] * 100 + +(tm[3] || 0);
      const t = parseDT(s);
      if (!t) return toNum(s);
      const date = t.y * 10000 + t.mo * 100 + t.d;
      return t.hasTime ? date * 1000000 + t.h * 10000 + t.mi * 100 + t.s : date;
    }],
    // ROW_NUMBER()/RANK()/DENSE_RANK()/NTILE() are BIGINT UNSIGNED in MySQL: integer arithmetic on them can't go below zero
    mysql_unsigned: [2, 2, (v, expr) => {
      if (typeof v === 'number' && Number.isInteger(v) && v < 0) throw new Error(`BIGINT UNSIGNED value is out of range in '(${toStr(expr)})'`);
      return v;
    }],
    timestampdiff: [3, 3, timestampDiff],
    timestampadd: [3, 3, (unit, n, d) => (n === null ? null : dateAdd(d, `${IV}${toStr(n)}${IV_SEP}${String(unit).replace(/^SQL_TSI_/i, '').toUpperCase()}`, 1))],
    mysql_extract: [2, 2, extract],
    year: [1, 1, dt1((t) => t.y)],
    month: [1, 1, dt1((t) => t.mo)],
    day: [1, 1, dt1((t) => t.d)],
    dayofmonth: [1, 1, dt1((t) => t.d)],
    dayofweek: [1, 1, dt1(dayOfWeek1)],
    weekday: [1, 1, dt1(weekday0)],
    dayofyear: [1, 1, dt1(dayOfYear)],
    week: [1, 2, (d, mode) => { const t = parseDT(d); return t ? calcWeek(t, weekMode(mode == null ? 0 : toInt(mode))).week : null; }],
    weekofyear: [1, 1, dt1((t) => calcWeek(t, weekMode(3)).week)],
    yearweek: [1, 2, (d, mode) => {
      const t = parseDT(d);
      if (!t) return null;
      const w = calcWeek(t, weekMode(mode == null ? 0 : toInt(mode)) | WEEK_YEAR);
      return w.year * 100 + w.week;
    }],
    quarter: [1, 1, dt1((t) => Math.ceil(t.mo / 3))],
    hour: [1, 1, (d) => { const t = parseTime(d); return t ? t.h : null; }],
    minute: [1, 1, (d) => { const t = parseTime(d); return t ? t.mi : null; }],
    second: [1, 1, (d) => { const t = parseTime(d); return t ? t.s : null; }],
    microsecond: [1, 1, dt1((t) => t.us)],
    dayname: [1, 1, dt1((t) => DAYS[dayOfWeek1(t) - 1])],
    monthname: [1, 1, dt1((t) => MONTHS[t.mo - 1])],
    last_day: [1, 1, dt1((t) => fmtDate(t.y, t.mo, daysInMonth(t.y, t.mo)))],
    to_days: [1, 1, dt1((t) => calcDaynr(t.y, t.mo, t.d))],
    from_days: [1, 1, (n) => { if (n === null) return null; const c = civilFromDays(toInt(n) - TO_DAYS_OFFSET); return fmtDate(c.y, c.m, c.d); }],
    makedate: [2, 2, (y, doy) => {
      if (y === null || doy === null || toInt(doy) < 1) return null;
      const c = civilFromDays(daysFromCivil(toInt(y), 1, 1) + toInt(doy) - 1);
      return fmtDate(c.y, c.m, c.d);
    }],
    date_format: [2, 2, (d, f) => dateFormat(d, f, false)],
    time_format: [2, 2, (d, f) => dateFormat(d, f, true)],
    str_to_date: [2, 2, strToDate],
    date: [1, 1, dt1((t) => fmtDate(t.y, t.mo, t.d))],
    timestamp: [1, 1, dt1((t) => fmtDT(t, true))],
    mysql_cast_date: [1, 1, dt1((t) => fmtDate(t.y, t.mo, t.d))],
    mysql_cast_datetime: [1, 1, dt1((t) => fmtDT(t, true))],
    mysql_cast_time: [1, 1, (d) => { const t = parseTime(d); return t ? secToTime(timeToSec(t)) : null; }],
    unix_timestamp: [0, 1, (d) => {
      if (d === undefined) return Math.floor(Date.now() / 1000);
      const t = parseDT(d);
      return t ? toSeconds(t) : null;
    }],
    from_unixtime: [1, 2, (n, f) => {
      if (n === null) return null;
      const s = fmtDT(fromSeconds(Math.trunc(toNum(n)), 0, true), true);
      return f === undefined ? s : dateFormat(s, f);
    }],
    now: [0, 1, () => fmtDT(nowParts(false), true)],
    sysdate: [0, 1, () => fmtDT(nowParts(false), true)],
    mysql_now: [0, 0, () => fmtDT(nowParts(false), true)],
    curdate: [0, 0, () => { const t = nowParts(false); return fmtDate(t.y, t.mo, t.d); }],
    curtime: [0, 1, () => { const t = nowParts(false); return `${pad(t.h)}:${pad(t.mi)}:${pad(t.s)}`; }],
    utc_date: [0, 0, () => { const t = nowParts(true); return fmtDate(t.y, t.mo, t.d); }],
    utc_timestamp: [0, 0, () => fmtDT(nowParts(true), true)],
    timediff: [2, 2, (a, b) => {
      if (a === null || b === null) return null;
      const da = parseDT(a), db = parseDT(b);
      if (da && db) return secToTime(toSeconds(da) - toSeconds(db));
      if (da || db) return null;
      const ta = parseTime(a), tb = parseTime(b);
      return ta && tb ? secToTime(timeToSec(ta) - timeToSec(tb)) : null;
    }],
    time_to_sec: [1, 1, (d) => { const t = parseTime(d); return t ? timeToSec(t) : null; }],
    sec_to_time: [1, 1, (n) => (n === null ? null : secToTime(toNum(n)))],
    // casts
    mysql_cast_int: [1, 1, (v) => (v === null ? null : typeof v === 'string' ? Math.trunc(toNum(v)) : mysqlRound(v, 0))],
    mysql_cast_decimal: [2, 2, (v, s) => (v === null ? null : mysqlRound(toNum(v), s))],
    // strings
    concat: [1, 1e9, (...a) => (anyNull(a) ? null : a.map(toStr).join(''))],
    left: [2, 2, (s, n) => (s === null || n === null ? null : chars(toStr(s)).slice(0, Math.max(0, toInt(n))).join(''))],
    right: [2, 2, (s, n) => {
      if (s === null || n === null) return null;
      const k = toInt(n);
      return k <= 0 ? '' : chars(toStr(s)).slice(-k).join('');
    }],
    lpad: [3, 3, (s, n, p) => pad3(s, n, p, true)],
    rpad: [3, 3, (s, n, p) => pad3(s, n, p, false)],
    repeat: [2, 2, (s, n) => (s === null || n === null ? null : toStr(s).repeat(Math.max(0, toInt(n))))],
    reverse: [1, 1, (s) => (s === null ? null : chars(toStr(s)).reverse().join(''))],
    space: [1, 1, (n) => (n === null ? null : ' '.repeat(Math.max(0, toInt(n))))],
    locate: [2, 3, locate],
    instr: [2, 2, (s, sub) => locate(sub, s)],
    substring: [2, 3, (...a) => mysqlSubstring(a[0], a[1], a[2], a.length === 3)],
    substr: [2, 3, (...a) => mysqlSubstring(a[0], a[1], a[2], a.length === 3)],
    mid: [3, 3, (s, p, l) => mysqlSubstring(s, p, l, true)],
    substring_index: [3, 3, substringIndex],
    char_length: [1, 1, (s) => (s === null ? null : chars(toStr(s)).length)],
    character_length: [1, 1, (s) => (s === null ? null : chars(toStr(s)).length)],
    length: [1, 1, (s) => (s === null ? null : new TextEncoder().encode(toStr(s)).length)],
    upper: [1, 1, (s) => (s === null ? null : simpleCase(toStr(s), true))],
    ucase: [1, 1, (s) => (s === null ? null : simpleCase(toStr(s), true))],
    lower: [1, 1, (s) => (s === null ? null : simpleCase(toStr(s), false))],
    lcase: [1, 1, (s) => (s === null ? null : simpleCase(toStr(s), false))],
    ascii: [1, 1, (s) => (s === null ? null : toStr(s).length ? toStr(s).charCodeAt(0) : 0)],
    field: [2, 1e9, (x, ...list) => {
      if (x === null) return 0;
      const k = toStr(x).toLowerCase();
      const i = list.findIndex((v) => v !== null && toStr(v).toLowerCase() === k);
      return i + 1;
    }],
    find_in_set: [2, 2, (x, list) => {
      if (x === null || list === null) return null;
      const i = toStr(list).split(',').findIndex((v) => v.toLowerCase() === toStr(x).toLowerCase());
      return i + 1;
    }],
    elt: [2, 1e9, (n, ...list) => (n === null ? null : list[toInt(n) - 1] ?? null)],
    strcmp: [2, 2, (a, b) => {
      if (a === null || b === null) return null;
      const x = toStr(a).toLowerCase(), y = toStr(b).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }],
    format: [2, 3, (x, d) => formatNumber(x, d)],
    mysql_trim: [3, 3, mysqlTrim],
    mysql_insert: [4, 4, (s, pos, len, ns) => {
      if (anyNull([s, pos, len, ns])) return null;
      const cs = chars(toStr(s)); pos = toInt(pos); len = toInt(len);
      if (pos < 1 || pos > cs.length) return toStr(s);
      return cs.slice(0, pos - 1).join('') + toStr(ns) + cs.slice(pos - 1 + len).join('');
    }],
    mysql_bxor: [2, 2, (a, b) => (a === null || b === null ? null : Number(BigInt.asUintN(64, BigInt(Math.trunc(toNum(a))) ^ BigInt(Math.trunc(toNum(b))))))],
    bin: [1, 1, (n) => (n === null ? null : Math.trunc(toNum(n)).toString(2))],
    uuid: [0, 0, () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'uuid-unavailable')],
    // numbers
    round: [1, 2, mysqlRound],
    truncate: [2, 2, mysqlTruncate],
    ceil: [1, 1, math1(Math.ceil)],
    ceiling: [1, 1, math1(Math.ceil)],
    floor: [1, 1, math1(Math.floor)],
    pow: [2, 2, (a, b) => (a === null || b === null ? null : toNum(a) ** toNum(b))],
    power: [2, 2, (a, b) => (a === null || b === null ? null : toNum(a) ** toNum(b))],
    sqrt: [1, 1, math1((x) => (x < 0 ? null : Math.sqrt(x)))],
    exp: [1, 1, math1(Math.exp)],
    ln: [1, 1, math1((x) => (x <= 0 ? null : Math.log(x)))],
    log: [1, 2, (a, b) => {
      if (a === null || (b !== undefined && b === null)) return null;
      if (b === undefined) return toNum(a) <= 0 ? null : Math.log(toNum(a));
      return toNum(a) <= 0 || toNum(b) <= 0 || toNum(a) === 1 ? null : Math.log(toNum(b)) / Math.log(toNum(a));
    }],
    log2: [1, 1, math1((x) => (x <= 0 ? null : Math.log2(x)))],
    log10: [1, 1, math1((x) => (x <= 0 ? null : Math.log10(x)))],
    mod: [2, 2, (a, b) => (a === null || b === null || toNum(b) === 0 ? null : toNum(a) % toNum(b))],
    pi: [0, 0, () => Math.PI],
    rand: [0, 1, () => Math.random()],
    sin: [1, 1, math1(Math.sin)], cos: [1, 1, math1(Math.cos)], tan: [1, 1, math1(Math.tan)],
    asin: [1, 1, math1(Math.asin)], acos: [1, 1, math1(Math.acos)], atan: [1, 2, (a, b) => (b === undefined ? (a === null ? null : Math.atan(toNum(a))) : Math.atan2(toNum(a), toNum(b)))],
    atan2: [2, 2, (a, b) => (a === null || b === null ? null : Math.atan2(toNum(a), toNum(b)))],
    degrees: [1, 1, math1((x) => (x * 180) / Math.PI)],
    radians: [1, 1, math1((x) => (x * Math.PI) / 180)],
    greatest: [2, 1e9, (...a) => (anyNull(a) ? null : a.reduce((m, v) => (compare(v, m) > 0 ? v : m)))],
    least: [2, 1e9, (...a) => (anyNull(a) ? null : a.reduce((m, v) => (compare(v, m) < 0 ? v : m)))],
    // conditionals & misc
    mysql_isnull: [1, 1, (v) => (v === null ? 1 : 0)],
    any_value: [1, 1, (v) => v],
    database: [0, 0, () => 'course'],
    // x OP ANY/ALL (subquery): the subquery's values arrive as a JSON array
    mysql_quantified: [4, 4, (x, op, json, isAll) => {
      const vals = json === null ? [] : JSON.parse(json);
      if (!vals.length) return isAll ? 1 : 0;
      if (x === null) return null;
      let unknown = false;
      for (const v of vals) {
        if (v === null) { unknown = true; continue; }
        const c = compare(x, v);
        const r = op === '=' ? c === 0 : op === '<>' || op === '!=' ? c !== 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
        if (isAll && !r) return 0;
        if (!isAll && r) return 1;
      }
      return unknown ? null : isAll ? 1 : 0;
    }],
    // regex
    regexp: [2, 2, (pattern, s) => regexpLike(s, pattern)],
    regexp_like: [2, 3, regexpLike],
    regexp_replace: [3, 6, regexpReplace],
    regexp_substr: [2, 5, (s, p, pos, occ, mt) => {
      if (s === null || p === null) return null;
      const ms = regexpMatches(s, p, pos, mt);
      const m = ms[(occ == null ? 1 : toInt(occ)) - 1];
      return m ? m[0] : null;
    }],
    regexp_instr: [2, 6, (s, p, pos, occ, ret, mt) => {
      if (s === null || p === null) return null;
      const ms = regexpMatches(s, p, pos, mt);
      const m = ms[(occ == null ? 1 : toInt(occ)) - 1];
      if (!m) return 0;
      return m.index + 1 + (ret ? m[0].length : 0);
    }],
  };

  function compare(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const na = Number(a), nb = Number(b);
    if (typeof a === 'number' || typeof b === 'number') {
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
    }
    const x = toStr(a).toLowerCase(), y = toStr(b).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // aggregates: name -> { init, step, finalize }
  const variance = (sample, sqrt) => ({
    init: () => ({ n: 0, mean: 0, m2: 0 }),
    step: (st, v) => {
      if (v === null) return st;
      const x = toNum(v);
      st.n++;
      const delta = x - st.mean;
      st.mean += delta / st.n;
      st.m2 += delta * (x - st.mean);
      return st;
    },
    finalize: (st) => {
      if (!st || st.n === 0 || (sample && st.n < 2)) return null;
      const v = st.m2 / (sample ? st.n - 1 : st.n);
      return sqrt ? Math.sqrt(v) : v;
    },
  });
  const aggregates = {
    mysql_gc_distinct: {
      init: () => ({ seen: new Set(), vals: [], sep: ',' }),
      step: (st, v, sep) => {
        if (sep !== null && sep !== undefined) st.sep = toStr(sep);
        if (v === null) return st;
        const s = toStr(v);
        const k = s.toLowerCase();
        if (!st.seen.has(k)) { st.seen.add(k); st.vals.push(s); }
        return st;
      },
      finalize: (st) => (st && st.vals.length ? st.vals.join(st.sep) : null),
    },
    std: variance(false, true),
    stddev: variance(false, true),
    stddev_pop: variance(false, true),
    stddev_samp: variance(true, true),
    variance: variance(false, false),
    var_pop: variance(false, false),
    var_samp: variance(true, false),
  };

  function register(db) {
    for (const [name, [min, max, fn]] of Object.entries(scalars)) db.create_function(name, arity(name, min, max, fn));
    for (const [name, agg] of Object.entries(aggregates)) db.create_aggregate(name, agg);
  }

  root.MySQLFunctions = {
    register, parseDT, fmtDT, fmtDate, dateFormat, mysqlRound, toStr, toNum, UNITS, IV, CS,
    names: Object.keys(scalars).concat(Object.keys(aggregates)),
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
