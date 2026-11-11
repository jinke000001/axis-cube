import inventory from'./accepted-demonstrations.json';import{getFormula}from'../demonstrator/catalog';import{formulaKey}from'./formula-key';
const entries=new Map(inventory.entries.map(e=>[e.id,e]));
export const isDemonstrationAvailable=(id:string)=>{const f=getFormula(id),e=entries.get(id);return!!f&&!!e&&e.sourceKey===formulaKey(f);};
export const availableDemonstrationCount=inventory.entries.filter(e=>isDemonstrationAvailable(e.id)).length;
export const approvedEntry=(id:string)=>isDemonstrationAvailable(id)?entries.get(id):undefined;
