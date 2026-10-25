import { expect, it, vi, afterEach } from "vitest";
import { applyAlgorithm, DEFAULT_PALETTE, SOLVED } from "./cube";
import { solveCFOP } from "./cfop";
import { newSession, readSession, saveSession, loadSession } from "./session";
import { readFollow, saveFollow } from "./follow";
afterEach(() => vi.unstubAllGlobals());

it("round-trips verified CFOP stages without changing legacy sessions or their follow identity", () => {
  const data = new Map<string,string>();
  vi.stubGlobal("localStorage", {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
  const facelets = applyAlgorithm(SOLVED, "R U");
  const legacy = newSession(facelets, "U' R'", DEFAULT_PALETTE, "original");
  saveSession(legacy); saveFollow(legacy,{enabled:true,completed:1});
  expect(readSession(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
  expect(readFollow(loadSession())).toEqual({enabled:true,completed:1});
  const result = solveCFOP(facelets);
  const session = newSession(facelets,result.solution,DEFAULT_PALETTE,"CFOP",{method:"cfop",phases:result.phases});
  saveSession(session);
  expect(loadSession()).toEqual(session);
  expect(JSON.parse(data.get("axis.cube.session.v1.previous")!)).toEqual(legacy);
  expect(readFollow(session)).toEqual({enabled:false,completed:0});
  expect(readFollow(legacy)).toEqual({enabled:true,completed:1});
});

it("rejects forged phase boundaries even when the full solution is valid", () => {
  const facelets = applyAlgorithm(SOLVED, "R U F2 D' L B");
  const result = solveCFOP(facelets);
  const session = newSession(facelets,result.solution,DEFAULT_PALETTE,"CFOP",{method:"cfop",phases:result.phases});
  const bad = JSON.parse(JSON.stringify(session));
  bad.phases[0].end = 0;
  expect(() => readSession(bad)).toThrow("阶段");
  expect(() => readSession({...session, phases:[]})).toThrow("阶段");
  expect(() => readSession({...session, method:"unknown"})).toThrow("求解方法");
});

it("retains old follow progress when a larger new session fails but small writes would succeed", () => {
  const data = new Map<string,string>();
  let rejectNewSession = false;
  vi.stubGlobal("localStorage", {
    getItem:(key:string)=>data.get(key)??null,
    setItem:(key:string,value:string)=>{
      if (rejectNewSession && key === "axis.cube.session.v1") throw new Error("quota");
      data.set(key,value);
    },
  });
  const old = newSession(applyAlgorithm(SOLVED,"R U"),"U' R'");
  expect(saveSession(old)).toBe(true);
  expect(saveFollow(old,{enabled:true,completed:1})).toBe(true);
  const next = newSession(SOLVED,"");
  rejectNewSession=true;
  expect(saveSession(next)).toBe(false);
  expect(saveFollow(next,{enabled:false,completed:0})).toBe(false);
  expect(loadSession()).toEqual(old);
  expect(readFollow(loadSession())).toEqual({enabled:true,completed:1});
});
