import {describe,it,expect,vi} from "vitest";
const row={batchId:"b1",stockItemId:"i1",locationId:"l1",categoryId:null,itemName:{en:"Milk"},baseUnit:"g",batchNumber:"EXP-1",productionDate:null,expiryDate:"2026-10-21T00:00:00Z",quantityRemaining:"2.500000",unitCost:"101",value:"253",daysToExpiry:1,horizon:1,timezone:"UTC",status:"approaching_expiry",usable:true,actions:{}};
vi.mock("@/lib/api/endpoints",()=>({api:{inventory:{expiryWorklist:async()=>[row,{...row,batchId:"b2",locationId:"l2"}],listItems:async()=>[]},organisation:{listLocations:async()=>[{id:"l1",locationType:"branch",refId:"br1"},{id:"l2",locationType:"branch",refId:"br2"}],listBranches:async()=>[],listWarehouses:async()=>[],listCentralKitchens:async()=>[]}}}));
vi.mock("@/lib/api/session",()=>({getTenantId:()=>"t1"}));
describe("Expiry worklist scope",()=>{
 it("preserves backend value and excludes other branches under selected branch scope",async()=>{const {httpServices}=await import("./http");const p=await httpServices.inventory.batches.list({scope:{tenantId:"t1",brandId:null,branchId:"br1"},filters:{expiryWorklist:"true"}});expect(p.rows).toHaveLength(1);expect(p.rows[0]).toMatchObject({locationId:"l1",quantity:{value:"2.500000"},value:{amount:253}});});
 it("retains tenant-wide rows without a branch filter",async()=>{const {httpServices}=await import("./http");const p=await httpServices.inventory.batches.list({filters:{expiryWorklist:"true"}});expect(p.rows).toHaveLength(2);});
});
