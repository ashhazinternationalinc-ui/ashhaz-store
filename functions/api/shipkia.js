import { isAdmin, json, readJson } from "../_lib/auth.js";
const API = "https://api.shipkia.com/oms";
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const clean = (v,n=300) => typeof v === "string" ? v.trim().slice(0,n) : "";
async function callShipkia(env,path,opts={}) {
  if (!env.SHIPKIA_API_KEY) throw new Error("SHIPKIA_API_KEY Cloudflare Secret is not configured.");
  const r=await fetch(API+path,{...opts,headers:{"x-api-key":env.SHIPKIA_API_KEY,"Accept":"application/json",...(opts.headers||{})}});
  const raw=await r.text(); let d={}; try { d=JSON.parse(raw); } catch { d={message:raw.slice(0,500)}; }
  if(!r.ok || d.success===false) throw new Error(d.message||d.error||`Shipkia API error (${r.status})`);
  return d;
}
export async function onRequestPost({request,env}) {
  if(!(await isAdmin(request,env))) return json({error:"Admin login required."},401);
  const data=await readJson(request)||{}; const action=clean(data.action,30);
  try {
    if(action==="serviceability") {
      const pincode=clean(data.pincode,10); if(!/^\d{6}$/.test(pincode)) return json({error:"Valid 6 digit delivery PIN required."},400);
      return json(await callShipkia(env,"/shipping/serviceability",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pincode})}));
    }
    const orderId=Number(data.order_id); if(!Number.isInteger(orderId)||orderId<1) return json({error:"Valid order ID required."},400);
    const order=await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first(); if(!order) return json({error:"Order not found."},404);
    if(action==="create_order") {
      if(order.shipkia_order_id) return json({error:"Shipkia order already created: "+order.shipkia_order_id},409);
      const {results:items=[]}=await env.DB.prepare("SELECT product_name,quantity,unit_price FROM order_items WHERE order_id=?").bind(orderId).all();
      if(!items.length) return json({error:"Order items not found."},400);
      const phone=clean(order.mobile,20).replace(/\D/g,"");
      const pickup=clean(env.SHIPKIA_PICKUP_ADDRESS,500) ||
        "Ashhaz International Inc, BP-38, Ekta Vihar Colony, Rampur Road, Moradabad, Uttar Pradesh 244001";
      const pickupPhone=clean(env.SHIPKIA_PICKUP_PHONE,20) || "7906073233";
      const xml=`<?xml version="1.0" encoding="UTF-8"?><root><pickup_address>${esc(pickup)}</pickup_address><delivery_phone>${esc(phone)}</delivery_phone><delivery_alternate_phone></delivery_alternate_phone><delivery_full_name>${esc(order.customer_name)}</delivery_full_name><delivery_address>${esc(order.address)}</delivery_address><delivery_postal_code>${esc(order.pincode)}</delivery_postal_code><delivery_landmark></delivery_landmark><is_billing_same>true</is_billing_same><billing_phone>${esc(phone)}</billing_phone><billing_full_name>${esc(order.customer_name)}</billing_full_name><billing_address>${esc(order.address)}</billing_address><billing_postal_code>${esc(order.pincode)}</billing_postal_code><billing_landmark></billing_landmark><payment_method>${order.payment_method==="COD"?"cod":"prepaid"}</payment_method><order_channel>Ashhaz Website</order_channel><product_details>${items.map(i=>`<product_details><product_name>${esc(i.product_name)}</product_name><unit_price>${Number(i.unit_price)}</unit_price><quantity>${Number(i.quantity)}</quantity><hsn_code></hsn_code><weight>0.5</weight><tax_rate>0</tax_rate><tax_preference>Inclusive</tax_preference><product_discount>0</product_discount></product_details>`).join("")}</product_details><shipping_charge>0</shipping_charge><transaction_charge>0</transaction_charge><gift_wrap_charge>0</gift_wrap_charge><additional_discount>0</additional_discount><prepaid_amount>${order.payment_method==="COD"?0:Number(order.total_amount)}</prepaid_amount><length>1</length><breadth>1</breadth><height>1</height><dead_weight>0.5</dead_weight><order_tag>${esc(order.order_number)}</order_tag><notes>Pickup contact: ${esc(pickupPhone)}</notes></root>`;
      const result=await callShipkia(env,"/orders",{method:"POST","Content-Type":"application/json";
      const sid=result?.result?.id||result?.result?.order_id||"";
      if(sid) await env.DB.prepare("UPDATE orders SET shipkia_order_id=?, courier_status='Order Created' WHERE id=?").bind(String(sid),orderId).run();
      return json({ok:true,shipkia_order_id:sid,result});
    }
    if(action==="quote") {
      if(!order.shipkia_order_id) return json({error:"Create Shipkia order first."},400);
      return json(await callShipkia(env,`/shipping/estimated-cost?order_id=${encodeURIComponent(order.shipkia_order_id)}&forward=true`,{method:"POST"}));
    }
    if(action==="book") {
      const quote=clean(data.quote_id,100); if(!quote||!order.shipkia_order_id) return json({error:"Shipkia order ID and quote ID are required."},400);
      const result=await callShipkia(env,"/shipping/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quote_id:quote,order_id:order.shipkia_order_id})});
      const x=result?.result||{}; await env.DB.prepare("UPDATE orders SET shipkia_awb=?, courier_partner=?, courier_status='Shipment Booked' WHERE id=?").bind(String(x.awb||""),String(x.courier_partner||""),orderId).run();
      return json({ok:true,result});
    }
    if(action==="track") {
      if(!order.shipkia_awb) return json({error:"AWB not available yet."},400);
      return json(await callShipkia(env,`/orders/get_order_tracking?tracking_id=${encodeURIComponent(order.shipkia_awb)}`,{method:"GET"}));
    }
    return json({error:"Unsupported Shipkia action."},400);
  } catch(e) { return json({error:e.message||"Shipkia request failed."},502); }
}
