(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortPick = factory();
})(globalThis, function () {
  'use strict';
  const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const stages = ['揀貨中', '配貨中', '已到達自提點'];
  function fees(productCents, packagingCents, rateBps) {
    if (![productCents, packagingCents, rateBps].every(n => Number.isSafeInteger(n) && n >= 0))
      throw Error('費用設定無效');
    const serviceCents = Math.floor((productCents * rateBps + 5000) / 10000);
    return { product: productCents / 100, service: serviceCents / 100, packaging: packagingCents / 100,
      total: (productCents + serviceCents + packagingCents) / 100, rateBps, currency: 'CNY' };
  }
  function minimum(productCents, config) {
    const rate = config.cnyToHKD;
    const minimumHKD = config.minimumHKD;
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(minimumHKD) || minimumHKD < 0)
      throw Error('起送門檻或匯率設定無效');
    const hkdCents = Math.round(productCents * Math.round(rate * 1000000) / 1000000);
    const shortCents = Math.max(0, Math.round(minimumHKD * 100) - hkdCents);
    return {rate, minimumHKD, subtotalHKD:hkdCents/100, shortHKD:shortCents/100};
  }
  function routes(store, ports) {
    const radians = n => n * Math.PI / 180;
    return ports.map(port => {
      const a = Math.sin(radians(port.lat-store.lat)/2)**2 +
        Math.cos(radians(store.lat))*Math.cos(radians(port.lat))*Math.sin(radians(port.lng-store.lng)/2)**2;
      return {...port, km:12742 * Math.asin(Math.sqrt(a))};
    }).sort((a,b)=>a.km-b.km);
  }
  function quote(catalog, storeId, portId, cart) {
    const store = catalog.stores.find(s => s.id === storeId);
    const port = catalog.ports.find(s => s.id === portId);
    if (!store || !port) throw Error('請重新選擇門店與路線');
    const used = {};
    let subtotal = 0, packaging = 0;
    const lines = cart.map(line => {
      const p = catalog.products.find(x => x.id === line.productId);
      const pack = catalog.packaging.find(x => x.id === line.packaging);
      if (!p || !pack || !p.sizes.includes(line.units) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100)
        throw Error('商品規格或數量無效');
      used[p.id] = (used[p.id] || 0) + line.units * line.quantity;
      if (used[p.id] > p.stock[storeId]) throw Error(p.name + ' 超出所選門店的示例庫存');
      const unitCents = Math.round(Math.round(p.price * 100) * line.units / p.packUnits);
      const amount = unitCents * line.quantity;
      const packAmount = Math.round(pack.fee * 100) * line.quantity;
      subtotal += amount;
      packaging += packAmount;
      return {...line, name:p.name, image:{art:p.art,color:p.color,english:p.english}, unit:p.unit, unitPrice:unitCents/100, packagingName:pack.name,
        packagingUnitPrice:pack.fee, productAmount:amount/100, packagingAmount:packAmount/100};
    });
    return {...fees(subtotal, packaging, catalog.stage1.serviceFeeBasisPoints), threshold:minimum(subtotal,catalog.stage1), store:{...store}, port:routes(store,[port])[0], lines};
  }
  function add(cart, item) {
    const next = cart.map(x => ({...x}));
    const existing = next.find(x => x.productId === item.productId && x.units === item.units && x.packaging === item.packaging);
    if (existing) existing.quantity++;
    else next.push({...item, quantity:1});
    return next;
  }
  function advance(order, expectedStep, at) {
    if (order.schema !== 'stage1' || order.history.length !== expectedStep || expectedStep >= stages.length)
      throw Error('訂單進度已更新，請重新選擇訂單。');
    return {...order, history:[...order.history, {stage:stages[expectedStep], at}]};
  }
  function matches(helpers, request) {
    const time = Date.parse(request.time);
    if (!(time > Date.now()) || !(request.weight > 0) || !(request.offer >= 0)) return [];
    return helpers.filter(h => h.portId === request.portId && h.capacity >= request.weight &&
      h.ask <= request.offer && Date.parse(h.time) > Date.now() && Math.abs(Date.parse(h.time)-time) <= 7200000)
      .sort((a,b) => a.ask-b.ask);
  }
  return {money, minimum, routes, fees, quote, add, advance, stages, matches};
});
