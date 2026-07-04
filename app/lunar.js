/**
 * lunar.js - 农历、干支、生肖、二十四节气计算
 * 农历数据表适用范围:1900-2100
 */
(function (global) {
  'use strict';

  // 农历数据:每年一个16进制数
  // 低4位:闰月月份(0表示无闰月);中12位:1-12月大小月(1为大月30天);高位:闰月大小
  var lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520 // 2100
  ];

  var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  var ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  var ANIMALS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  var MONTH_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  var DAY_CN = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
  ];

  var TERMS = [
    '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
    '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
    '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
  ];
  // 寿星通用公式 C 值(2000-2099),按月排列:每月两个节气
  var TERM_C_21 = [
    5.4055, 20.12,  // 1月 小寒 大寒
    3.87, 18.73,    // 2月 立春 雨水
    5.63, 20.646,   // 3月 惊蛰 春分
    4.81, 20.1,     // 4月 清明 谷雨
    5.52, 21.04,    // 5月 立夏 小满
    5.678, 21.37,   // 6月 芒种 夏至
    7.108, 22.83,   // 7月 小暑 大暑
    7.5, 23.13,     // 8月 立秋 处暑
    7.646, 23.042,  // 9月 白露 秋分
    8.318, 23.438,  // 10月 寒露 霜降
    7.438, 22.36,   // 11月 立冬 小雪
    7.18, 21.94     // 12月 大雪 冬至
  ];
  // 寿星公式的少量例外年份修正:key = "年-月-序(0/1)",value = 天数偏移
  var TERM_FIX = {
    '2026-1-1': 0, '2082-1-1': 1, '2084-3-1': 1, '2008-5-1': 1,
    '1902-6-1': 1, '1928-6-1': 1, '1925-7-1': 1, '2016-7-1': 1,
    '1922-8-1': 1, '2002-9-1': 1, '2089-10-0': 1, '2089-11-0': 1,
    '1978-11-0': 1, '1954-12-0': 1, '2021-12-1': -1, '1918-12-1': -1
  };

  // 农历某年总天数
  function lunarYearDays(y) {
    var sum = 348;
    for (var i = 0x8000; i > 0x8; i >>= 1) {
      sum += (lunarInfo[y - 1900] & i) ? 1 : 0;
    }
    return sum + leapDays(y);
  }
  // 农历某年闰月月份,0为无闰
  function leapMonth(y) { return lunarInfo[y - 1900] & 0xf; }
  // 闰月天数
  function leapDays(y) {
    if (leapMonth(y)) return (lunarInfo[y - 1900] & 0x10000) ? 30 : 29;
    return 0;
  }
  // 农历 y 年 m 月天数
  function monthDays(y, m) {
    return (lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29;
  }

  /** 公历转农历。date: Date 对象(取本地日期) */
  function solar2lunar(date) {
    var y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    if (y < 1900 || y > 2100) return null;
    // 与农历基准日 1900-01-31(正月初一)的天数差
    var offset = Math.round((Date.UTC(y, m, d) - Date.UTC(1900, 0, 31)) / 86400000);

    var ly = 1900, temp = 0;
    for (; ly < 2101 && offset > 0; ly++) {
      temp = lunarYearDays(ly);
      offset -= temp;
    }
    if (offset < 0) { offset += temp; ly--; }

    var leap = leapMonth(ly);
    var isLeap = false;
    var lm = 1;
    for (; lm < 13 && offset > 0; lm++) {
      if (leap > 0 && lm === leap + 1 && !isLeap) {
        --lm; isLeap = true; temp = leapDays(ly);
      } else {
        temp = monthDays(ly, lm);
      }
      if (isLeap && lm === leap + 1) isLeap = false;
      offset -= temp;
      if (isLeap && lm === leap + 1) isLeap = false;
    }
    if (offset === 0 && leap > 0 && lm === leap + 1) {
      if (isLeap) { isLeap = false; } else { isLeap = true; --lm; }
    }
    if (offset < 0) { offset += temp; --lm; }
    var ld = offset + 1;

    // 干支纪年以立春为界(此处简化:以农历年为界,民俗常用)
    var gzYear = GAN[(ly - 4) % 10] + ZHI[(ly - 4) % 12];
    var animal = ANIMALS[(ly - 4) % 12];

    // 干支纪日:2000-01-07 为甲子日
    var dayCyclical = Math.round((Date.UTC(y, m, d) - Date.UTC(2000, 0, 7)) / 86400000);
    var gzDay = GAN[((dayCyclical % 10) + 10) % 10] + ZHI[((dayCyclical % 12) + 12) % 12];

    return {
      lYear: ly, lMonth: lm, lDay: ld, isLeap: isLeap,
      monthCn: (isLeap ? '闰' : '') + MONTH_CN[lm - 1] + '月',
      dayCn: DAY_CN[ld - 1],
      gzYear: gzYear, gzDay: gzDay, animal: animal
    };
  }

  /** 获取 y 年第 n 个节气(n: 0小寒 ... 23冬至)对应的公历日。返回 {month, day} */
  function getTerm(y, n) {
    var month = Math.floor(n / 2) + 1;
    var idx = n % 2;
    var C = TERM_C_21[n];
    var D = 0.2422;
    var Y = y % 100;
    var L;
    if (month === 1 || month === 2) {
      // 1、2月按上一年的规则修正闰年
      L = Math.floor((Y - 1) / 4);
    } else {
      L = Math.floor(Y / 4);
    }
    var day = Math.floor(Y * D + C) - L;
    var fix = TERM_FIX[y + '-' + month + '-' + idx];
    if (fix) day += fix;
    return { month: month, day: day };
  }

  /** 某公历日期是否节气,是则返回节气名,否则 null */
  function getTermOfDate(date) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    for (var i = 0; i < 2; i++) {
      var n = (m - 1) * 2 + i;
      var t = getTerm(y, n);
      if (t.month === m && t.day === d) return TERMS[n];
    }
    return null;
  }

  global.Lunar = {
    solar2lunar: solar2lunar,
    getTerm: getTerm,
    getTermOfDate: getTermOfDate,
    TERMS: TERMS,
    MONTH_CN: MONTH_CN,
    DAY_CN: DAY_CN,
    monthDays: monthDays,
    leapMonth: leapMonth,
    leapDays: leapDays
  };
})(typeof window !== 'undefined' ? window : globalThis);
