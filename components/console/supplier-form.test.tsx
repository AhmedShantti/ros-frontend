import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {render,screen,cleanup,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const create=vi.fn(),update=vi.fn(); let allowed=true;
vi.mock("@/lib/console/services",()=>({services:{purchasing:{suppliers:{create:(...a:unknown[])=>create(...a),update:(...a:unknown[])=>update(...a)}}}}));
vi.mock("@/lib/console/providers",()=>({usePermission:()=>allowed,useI18n:()=>({t:(s:string)=>s})}));
vi.mock("@/lib/console/actions",()=>({useAction:()=>({pending:false,error:null,run:async(fn:()=>Promise<unknown>,o:any)=>o.onSuccess(await fn())})}));
import {SupplierDrawer,supplierMinor,supplierMajor} from "./supplier-form";
beforeEach(()=>{allowed=true;vi.clearAllMocks();create.mockResolvedValue({id:"created",active:true});});afterEach(cleanup);
describe("Supplier master form",()=>{
 it("renders required fields and structured address/contact editors",async()=>{render(<SupplierDrawer supplier={null} open onClose={vi.fn()} onSaved={vi.fn()}/>);expect(screen.getByRole("button",{name:"common.create"})).toBeDisabled();await userEvent.click(screen.getByRole("button",{name:"pur.addAddress"}));await userEvent.click(screen.getByRole("button",{name:"pur.addContact"}));expect(screen.getByLabelText("pur.address.line1 1")).toBeInTheDocument();expect(screen.getByLabelText("pur.contact.name 1")).toBeInTheDocument();});
 it("creates with precise amount and all supported master fields",async()=>{const done=vi.fn();render(<SupplierDrawer supplier={null} open onClose={vi.fn()} onSaved={done}/>);await userEvent.type(screen.getByLabelText("common.code")," S ");await userEvent.type(screen.getByLabelText("pur.legalName"),"Synthetic");const money=screen.getByLabelText("pur.minimumOrder (EGP)");await userEvent.clear(money);await userEvent.type(money,"9999999999999999.99");await userEvent.click(screen.getByRole("button",{name:"common.create"}));await waitFor(()=>expect(create).toHaveBeenCalledWith(expect.objectContaining({code:"S",minimumOrderValueMinor:"999999999999999999",contacts:[],addresses:[],currencyCode:"EGP"})));expect(done).toHaveBeenCalledWith("pur.supplierCreated",{id:"created",active:true});});
 it("blocks unauthorized creation",()=>{allowed=false;render(<SupplierDrawer supplier={null} open onClose={vi.fn()} onSaved={vi.fn()}/>);expect(screen.getByText("pur.supplierDenied")).toBeInTheDocument();expect(screen.queryByRole("button",{name:"common.create"})).not.toBeInTheDocument();});
 it.each(["-1","1.234","bad"])("rejects invalid monetary input %s",v=>{expect(supplierMinor(v,"EGP")).toBeNull();});
 it("round-trips currency exponents without floating point",()=>{expect(supplierMinor("1.234","KWD")).toBe("1234");expect(supplierMajor("1234","KWD")).toBe("1.234");expect(supplierMinor("12.5","JPY")).toBeNull();});
 it("edits and reactivates without discarding existing contacts and addresses",async()=>{
   const supplier={id:"sup",code:"S",legalName:{en:"Synthetic",ar:""},tradingName:{en:"Trade",ar:""},taxRegistration:"",currency:"EGP",paymentTermsDays:14,leadTimeDays:3,minimumOrderValue:{amount:0,currency:"EGP"},deliveryDays:["sun"],active:false,addresses:[{line1:"One"},{line1:"Two"}],contacts:[{name:"First"},{name:"Second"}]} as any;
   update.mockResolvedValue({...supplier,active:true});
   render(<SupplierDrawer supplier={supplier} open onClose={vi.fn()} onSaved={vi.fn()}/>);
   await userEvent.click(screen.getByRole("switch",{name:"pur.activeSupplier"}));
   await userEvent.click(screen.getByRole("button",{name:"common.save"}));
   await waitFor(()=>expect(update).toHaveBeenCalledWith("sup",expect.objectContaining({active:true,addresses:supplier.addresses,contacts:supplier.contacts})));
 });
 it.each(["-1","bad","1.5"])("does not silently coerce invalid payment terms %s",async value=>{
   render(<SupplierDrawer supplier={null} open onClose={vi.fn()} onSaved={vi.fn()}/>);
   await userEvent.type(screen.getByLabelText("common.code"),"S");await userEvent.type(screen.getByLabelText("pur.legalName"),"Synthetic");
   const terms=screen.getByLabelText("pur.paymentTerms");await userEvent.clear(terms);await userEvent.type(terms,value);
   expect(screen.getByRole("button",{name:"common.create"})).toBeDisabled();expect(create).not.toHaveBeenCalled();
 });

});
