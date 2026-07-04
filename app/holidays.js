/**
 * holidays.js - 节日与法定节假日数据
 * - 公历节日 / 农历节日:按规则每年自动计算
 * - 法定节假日"休/班"安排:按国务院每年发布的通知硬编码,可自行增补
 */
(function (global) {
  'use strict';

  // 公历节日 "月-日": 名称
  var SOLAR_FESTIVALS = {
    '1-1': '元旦',
    '2-14': '情人节',
    '3-8': '妇女节',
    '3-12': '植树节',
    '4-1': '愚人节',
    '5-1': '劳动节',
    '5-4': '青年节',
    '6-1': '儿童节',
    '7-1': '建党节',
    '8-1': '建军节',
    '9-10': '教师节',
    '10-1': '国庆节',
    '12-24': '平安夜',
    '12-25': '圣诞节'
  };

  // 农历节日 "月-日": 名称(不含除夕,除夕单独判断)
  var LUNAR_FESTIVALS = {
    '1-1': '春节',
    '1-15': '元宵节',
    '2-2': '龙抬头',
    '5-5': '端午节',
    '7-7': '七夕节',
    '7-15': '中元节',
    '8-15': '中秋节',
    '9-9': '重阳节',
    '12-8': '腊八节',
    '12-23': '北方小年',
    '12-24': '南方小年'
  };

  /**
   * 法定节假日安排(国务院办公厅通知)
   * key: "YYYY-M-D", value: 'rest'(休) 或 'work'(调休上班)
   * 注意:未来年份数据以官方发布为准,可在此处自行修改。
   */
  var LEGAL = {
    // ===== 2025 年 =====
    '2025-1-1': 'rest',
    '2025-1-26': 'work',
    '2025-1-28': 'rest', '2025-1-29': 'rest', '2025-1-30': 'rest', '2025-1-31': 'rest',
    '2025-2-1': 'rest', '2025-2-2': 'rest', '2025-2-3': 'rest', '2025-2-4': 'rest',
    '2025-2-8': 'work',
    '2025-4-4': 'rest', '2025-4-5': 'rest', '2025-4-6': 'rest',
    '2025-4-27': 'work',
    '2025-5-1': 'rest', '2025-5-2': 'rest', '2025-5-3': 'rest', '2025-5-4': 'rest', '2025-5-5': 'rest',
    '2025-5-31': 'rest', '2025-6-1': 'rest', '2025-6-2': 'rest',
    '2025-9-28': 'work',
    '2025-10-1': 'rest', '2025-10-2': 'rest', '2025-10-3': 'rest', '2025-10-4': 'rest',
    '2025-10-5': 'rest', '2025-10-6': 'rest', '2025-10-7': 'rest', '2025-10-8': 'rest',
    '2025-10-11': 'work',

    // ===== 2026 年(请以国务院办公厅正式通知为准,可自行修改)=====
    '2026-1-1': 'rest', '2026-1-2': 'rest', '2026-1-3': 'rest',
    '2026-2-15': 'rest', '2026-2-16': 'rest', '2026-2-17': 'rest', '2026-2-18': 'rest',
    '2026-2-19': 'rest', '2026-2-20': 'rest', '2026-2-21': 'rest', '2026-2-22': 'rest',
    '2026-4-4': 'rest', '2026-4-5': 'rest', '2026-4-6': 'rest',
    '2026-5-1': 'rest', '2026-5-2': 'rest', '2026-5-3': 'rest', '2026-5-4': 'rest', '2026-5-5': 'rest',
    '2026-6-19': 'rest', '2026-6-20': 'rest', '2026-6-21': 'rest',
    '2026-9-25': 'rest', '2026-9-26': 'rest', '2026-9-27': 'rest',
    '2026-10-1': 'rest', '2026-10-2': 'rest', '2026-10-3': 'rest', '2026-10-4': 'rest',
    '2026-10-5': 'rest', '2026-10-6': 'rest', '2026-10-7': 'rest'
  };

  /** 返回某公历日期的节日名数组(公历节日 + 农历节日 + 除夕) */
  function getFestivals(date, lunarObj) {
    var res = [];
    var key = (date.getMonth() + 1) + '-' + date.getDate();
    if (SOLAR_FESTIVALS[key]) res.push(SOLAR_FESTIVALS[key]);
    // 母亲节:5月第2个周日;父亲节:6月第3个周日;感恩节:11月第4个周四
    var nth = Math.ceil(date.getDate() / 7);
    if (date.getMonth() === 4 && date.getDay() === 0 && nth === 2) res.push('母亲节');
    if (date.getMonth() === 5 && date.getDay() === 0 && nth === 3) res.push('父亲节');
    if (date.getMonth() === 10 && date.getDay() === 4 && nth === 4) res.push('感恩节');

    if (lunarObj && !lunarObj.isLeap) {
      var lkey = lunarObj.lMonth + '-' + lunarObj.lDay;
      if (LUNAR_FESTIVALS[lkey]) res.push(LUNAR_FESTIVALS[lkey]);
      // 除夕:腊月最后一天
      if (lunarObj.lMonth === 12 &&
          lunarObj.lDay === global.Lunar.monthDays(lunarObj.lYear, 12) &&
          global.Lunar.leapMonth(lunarObj.lYear) !== 12) {
        res.push('除夕');
      }
    }
    return res;
  }

  /** 返回 'rest' | 'work' | null */
  function getLegalStatus(date) {
    var key = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
    return LEGAL[key] || null;
  }

  global.Holidays = {
    getFestivals: getFestivals,
    getLegalStatus: getLegalStatus,
    LEGAL: LEGAL
  };
})(typeof window !== 'undefined' ? window : globalThis);
