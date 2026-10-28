import { HttpError } from '../http.js';
import { isUuid } from './postgres-repository.js';
export function exact(value, fields) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k)))throw new HttpError(400,'Unexpected or invalid fields.');
 return value;
}
export function text(value,max=1000,{optional=false}={}) {
 if(optional&&(value===undefined||value===null||value===''))return '';
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new HttpError(400,'A valid text value is required.');
 return value.trim();
}
export function integer(value,min=0,max=40000) {if(!Number.isSafeInteger(value)||value<min||value>max)throw new HttpError(400,'A valid integer is required.');return value;}
export function uuid(value){if(!isUuid(value))throw new HttpError(400,'A valid record ID is required.');return value;}
export function timestamp(value) {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))throw new HttpError(400,'A valid timestamp is required.');return new Date(value).toISOString();}
export function date(value) {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new HttpError(400,'A valid calendar date is required.');return value;}
export const iso=value=>value instanceof Date?value.toISOString():value;
export function owner(actor){if(actor?.role!=='OWNER')throw new HttpError(403,'Owner access is required.');}
export function partner(actor){if(actor?.role!=='PARTNER')throw new HttpError(403,'Partner access is required.');}
