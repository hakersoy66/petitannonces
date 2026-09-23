import assert from "node:assert/strict";

type State={
  orderStatus:"PENDING_PAYMENT"|"PAID"|"SHIPPED"|"DELIVERED"|"COMPLETED"|"DISPUTED"|"REFUNDED";
  deliveredAt?:number;
  protectionEndsAt?:number;
  payoutEligibleAt?:number;
  buyerConfirmed?:boolean;
  activeDispute?:boolean;
  activeReturn?:boolean;
  activeRefund?:boolean;
  sellerReady?:boolean;
  payoutStatus?:"PENDING"|"BLOCKED"|"PROCESSING"|"PAID"|"FAILED";
  refundedMinor:number;
  paymentMinor:number;
  seenEvents:Set<string>;
};
const H=3600_000,D=24*H;
const delivered=(s:State,at:number)=>{s.orderStatus="DELIVERED";s.deliveredAt=at;s.protectionEndsAt=at+48*H;s.payoutEligibleAt=at+21*D};
const confirm=(s:State,at:number)=>{assert.equal(s.orderStatus,"DELIVERED");s.buyerConfirmed=true;s.orderStatus="COMPLETED";assert.ok(s.payoutEligibleAt&&s.payoutEligibleAt>=at)};
const autoProtect=(s:State,at:number)=>{if(s.orderStatus==="DELIVERED"&&s.protectionEndsAt!<=at)s.orderStatus="COMPLETED"};
const readiness=(s:State,now:number)=>{
  if(s.activeDispute)return "BLOCKED_DISPUTE";
  if(s.activeReturn)return "BLOCKED_RETURN";
  if(s.activeRefund)return "BLOCKED_REFUND";
  if(!s.sellerReady)return "WAITING_IBAN";
  if(s.orderStatus!=="COMPLETED")return "WAITING_COMPLETION";
  if(!s.payoutEligibleAt)return "SCHEDULE_MISSING";
  if(s.payoutEligibleAt>now)return "SCHEDULED";
  if(s.payoutStatus==="PROCESSING")return "PAYOUT_PROCESSING";
  if(s.payoutStatus==="PAID")return "PAID";
  return "READY";
};
const refund=(s:State,amount:number)=>{const remaining=s.paymentMinor-s.refundedMinor;assert.ok(amount>0&&amount<=remaining);s.refundedMinor+=amount;if(s.refundedMinor===s.paymentMinor)s.orderStatus="REFUNDED"};
const webhook=(s:State,id:string,fn:()=>void)=>{if(s.seenEvents.has(id))return false;s.seenEvents.add(id);fn();return true};
function base():State{return{orderStatus:"PAID",sellerReady:true,refundedMinor:0,paymentMinor:10000,seenEvents:new Set()}}
const t0=Date.UTC(2026,8,6,12,0,0);

// 1. delivery policy = 21 days after delivery; the 48h buyer protection is included inside that delay.
{
  const s=base();delivered(s,t0);assert.equal(s.protectionEndsAt,t0+2*D);assert.equal(s.payoutEligibleAt,t0+21*D);assert.equal(readiness(s,t0+2*D),"WAITING_COMPLETION");autoProtect(s,t0+2*D);assert.equal(s.orderStatus,"COMPLETED");assert.equal(readiness(s,t0+20*D),"SCHEDULED");assert.equal(readiness(s,t0+21*D),"READY");
}
// 2. early confirmation never shortens the 21-day payout date.
{
  const s=base();delivered(s,t0);const eligible=s.payoutEligibleAt;confirm(s,t0+6*H);assert.equal(s.payoutEligibleAt,eligible);assert.equal(readiness(s,t0+2*D),"SCHEDULED");
}
// 3. all blockers win over payout readiness.
{
  const s=base();delivered(s,t0);autoProtect(s,t0+2*D);s.activeDispute=true;assert.equal(readiness(s,t0+24*D),"BLOCKED_DISPUTE");s.activeDispute=false;s.activeReturn=true;assert.equal(readiness(s,t0+24*D),"BLOCKED_RETURN");s.activeReturn=false;s.activeRefund=true;assert.equal(readiness(s,t0+24*D),"BLOCKED_REFUND");s.activeRefund=false;s.sellerReady=false;assert.equal(readiness(s,t0+24*D),"WAITING_IBAN");
}
// 4. partial/full refund boundaries.
{
  const s=base();refund(s,2500);assert.equal(s.refundedMinor,2500);assert.notEqual(s.orderStatus,"REFUNDED");assert.throws(()=>refund(s,8000));refund(s,7500);assert.equal(s.orderStatus,"REFUNDED");
}
// 5. webhook replay is idempotent.
{
  const s=base();let calls=0;assert.equal(webhook(s,"evt_1",()=>calls++),true);assert.equal(webhook(s,"evt_1",()=>calls++),false);assert.equal(calls,1);
}
// 6. processing/paid payout states remain distinct.
{
  const s=base();delivered(s,t0);autoProtect(s,t0+2*D);s.payoutStatus="PROCESSING";assert.equal(readiness(s,t0+24*D),"PAYOUT_PROCESSING");s.payoutStatus="PAID";assert.equal(readiness(s,t0+24*D),"PAID");
}
console.log(JSON.stringify({mode:"simulation",scenarios:6,passed:6,policy:"payout eligible on day 21 after delivery; 48h buyer protection included",financialCalls:0},null,2));
