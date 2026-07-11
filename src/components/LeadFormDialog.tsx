import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateLead, useUpdateLead } from "@/hooks/usePipedrive";

const schema = z.object({
  name: z.string().trim().max(150).optional().or(z.literal("")),
  email: z.string().trim().max(255).email("Email inválido").optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(50).optional().or(z.literal("")),
  company_name: z.string().trim().max(150).optional().or(z.literal("")),
  title: z.string().trim().max(150).optional().or(z.literal("")),
  website: z.string().trim().max(255).optional().or(z.literal("")),
  instagram_url: z.string().trim().max(255).optional().or(z.literal("")),
  linkedin_url: z.string().trim().max(255).optional().or(z.literal("")),
  linkedin_company_url: z.string().trim().max(255).optional().or(z.literal("")),
  facebook_url: z.string().trim().max(255).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  status: z.enum(["new", "contacted", "qualified", "unqualified", "converted"]),
  source: z.string().trim().max(50).optional().or(z.literal("")),
}).refine(
  (v) => Boolean(
    (v.name && v.name.trim()) ||
    (v.company_name && v.company_name.trim()) ||
    (v.website && v.website.trim()) ||
    (v.whatsapp && v.whatsapp.trim()) ||
    (v.phone && v.phone.trim()) ||
    (v.instagram_url && v.instagram_url.trim()) ||
    (v.linkedin_company_url && v.linkedin_company_url.trim()) ||
    (v.email && v.email.trim())
  ),
  { message: "Informe ao menos nome, empresa, site, WhatsApp, telefone, e-mail ou rede social", path: ["name"] }
);


type FormValues = z.infer<typeof schema>;

export interface LeadFormLead {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  company_name?: string | null;
  title?: string | null;
  website?: string | null;
  instagram_url?: string | null;
  linkedin_url?: string | null;
  linkedin_company_url?: string | null;
  facebook_url?: string | null;
  address?: string | null;
  status?: string | null;
  source?: string | null;
}


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: LeadFormLead | null;
}

export function LeadFormDialog({ open, onOpenChange, lead }: Props) {
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const isEdit = !!lead?.id;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      whatsapp: "",
      company_name: "",
      title: "",
      website: "",
      instagram_url: "",
      linkedin_url: "",
      linkedin_company_url: "",
      facebook_url: "",
      address: "",
      status: "new",
      source: "manual",
    },
  });


  useEffect(() => {
    if (!open) {
      form.reset();
      return;
    }
    if (lead) {
      form.reset({
        name: lead.name || "",
        email: lead.email || "",
        phone: lead.whatsapp || lead.phone || "",
        whatsapp: lead.whatsapp || lead.phone || "",
        company_name: lead.company_name || "",
        title: lead.title || "",
        website: lead.website || "",
        instagram_url: lead.instagram_url || "",
        linkedin_url: lead.linkedin_url || "",
        linkedin_company_url: lead.linkedin_company_url || "",
        facebook_url: lead.facebook_url || "",
        address: lead.address || "",
        status: (lead.status as FormValues["status"]) || "new",
        source: lead.source || "manual",
      });
    }
  }, [open, lead, form]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      name: values.name,
      status: values.status,
      email: values.email || null,
      phone: (values.whatsapp || values.phone) || null,
      whatsapp: (values.whatsapp || values.phone) || null,
      company_name: values.company_name || null,
      title: values.title || null,
      website: values.website || null,
      instagram_url: values.instagram_url || null,
      linkedin_url: values.linkedin_url || null,
      linkedin_company_url: values.linkedin_company_url || null,
      facebook_url: values.facebook_url || null,
      address: values.address || null,
      source: values.source || "manual",
    };
    if (isEdit && lead?.id) {
      await updateLead.mutateAsync({ id: lead.id, ...payload });
    } else {
      await createLead.mutateAsync(payload);
    }
    onOpenChange(false);
  };


  const pending = createLead.isPending || updateLead.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Lead" : "Novo Lead"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Nome</FormLabel>
                  <FormControl><Input placeholder="Deixe em branco se for canal corporativo (recepção/redes)" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="whatsapp" render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone (WhatsApp)</FormLabel>
                  <FormControl><Input placeholder="+5511999998888" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="company_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Empresa</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Cargo</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="website" render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="instagram_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>Instagram</FormLabel>
                  <FormControl><Input placeholder="https://instagram.com/usuario" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="linkedin_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>LinkedIn (pessoa)</FormLabel>
                  <FormControl><Input placeholder="https://linkedin.com/in/..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="linkedin_company_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>LinkedIn (empresa)</FormLabel>
                  <FormControl><Input placeholder="https://linkedin.com/company/..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="facebook_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>Facebook</FormLabel>
                  <FormControl><Input placeholder="https://facebook.com/..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="source" render={({ field }) => (
                <FormItem>
                  <FormLabel>Origem</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Endereço</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="new">Novo</SelectItem>
                      <SelectItem value="contacted">Contatado</SelectItem>
                      <SelectItem value="qualified">Qualificado</SelectItem>
                      <SelectItem value="unqualified">Desqualificado</SelectItem>
                      <SelectItem value="converted">Convertido</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Salvar lead"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
