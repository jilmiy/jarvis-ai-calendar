/**
 * almanac.js - 简易黄历宜忌
 * 依据日期生成确定性的宜忌条目(民俗参考,仅供娱乐)
 */
(function (global) {
  'use strict';

  var YI = [
    '祭祀', '祈福', '出行', '嫁娶', '搬家', '入宅', '开业', '交易',
    '会友', '订盟', '纳财', '栽种', '扫舍', '理发', '沐浴', '安床',
    '动土', '上梁', '求医', '习艺'
  ];
  var JI = [
    '动土', '安葬', '开仓', '出货', '词讼', '远行', '嫁娶', '开业',
    '入宅', '搬家', '破土', '掘井', '伐木', '置产', '纳畜', '求财'
  ];

  // 简单的确定性伪随机(同一天结果固定)
  function seedRandom(seed) {
    return function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function pick(list, rnd, count, exclude) {
    var pool = list.slice();
    var res = [];
    while (res.length < count && pool.length) {
      var i = Math.floor(rnd() * pool.length);
      var item = pool.splice(i, 1)[0];
      if (exclude && exclude.indexOf(item) !== -1) continue;
      res.push(item);
    }
    return res;
  }

  function getAlmanac(date) {
    var seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    var rnd = seedRandom(seed);
    var yi = pick(YI, rnd, 4);
    var ji = pick(JI, rnd, 4, yi);
    return { yi: yi, ji: ji };
  }

  global.Almanac = { getAlmanac: getAlmanac };
})(typeof window !== 'undefined' ? window : globalThis);
