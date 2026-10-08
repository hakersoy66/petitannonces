import test from "node:test";
import assert from "node:assert/strict";
import {
 COOKIE_STORAGE_KEY,COOKIE_POLICY_VERSION,COOKIE_CONSENT_TTL_MS,
 COOKIE_REJECT_ALL,COOKIE_ACCEPT_ALL,cookieDecisionValid
} from "./cookie-consent-policy";

const now=Date.parse("2026-10-09T12:00:00.000Z");
function example(offset=0,options=COOKIE_ACCEPT_ALL){
 return {...options,policyVersion:COOKIE_POLICY_VERSION,savedAt:new Date(now-offset).toISOString()};
}
test("existing consent key and policy version are stable (visual redesign never reprompts)",()=>{
 assert.equal(COOKIE_STORAGE_KEY,"pa_cookie_consent_v1");
 assert.equal(COOKIE_POLICY_VERSION,"2026-09-meta");
 assert.equal(cookieDecisionValid(example(45*24*60*60*1000),now),true);
});
test("both accept and reject (and partial consent) remain saved for 180 days",()=>{
 for(const choices of [COOKIE_ACCEPT_ALL,COOKIE_REJECT_ALL,{analytics:true,personalization:false,advertising:false}]){
  assert.ok(cookieDecisionValid(example(COOKIE_CONSENT_TTL_MS-1,choices),now));
  assert.ok(!cookieDecisionValid(example(COOKIE_CONSENT_TTL_MS,choices),now));
 }
});
test("unknown future dates, invalid choices and changed policy require reprompt",()=>{
 assert.equal(cookieDecisionValid(example(-60_000),now),false);
 assert.equal(cookieDecisionValid({...example(),policyVersion:"different"},now),false);
 assert.equal(cookieDecisionValid({...example(),analytics:"yes"},now),false);
 assert.equal(cookieDecisionValid(null,now),false);
 assert.equal(cookieDecisionValid({...example(),savedAt:""},now),false);
});
