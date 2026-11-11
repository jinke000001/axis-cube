import{useEffect,useState,useSyncExternalStore}from'react';import{RestoreFlow}from'./flow';import{localSolveStore}from'./storage';import{Solver}from'./solver';
export function useRestore(){const[flow]=useState(()=>new RestoreFlow(localSolveStore(),new Solver()));const state=useSyncExternalStore(flow.subscribe,flow.snapshot);useEffect(()=>()=>flow.dispose(),[flow]);return{flow,state};}
