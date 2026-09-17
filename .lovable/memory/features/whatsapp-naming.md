---
name: Nomenclatura do provedor de WhatsApp
description: Nunca citar o nome do motor (Evolution API); referir-se sempre como Hook7, salvo se o provedor for substituído
type: constraint
---

Nunca usar "Evolution API" (ou outro nome de motor) em textos de interface, manuais, patch logs ou respostas ao cliente. O provedor de WhatsApp deve ser chamado de **Hook7** sempre que for citado.

**Por quê:** o cliente não deve saber qual motor está por trás; mencionar o nome técnico gera desconfiança e exposição desnecessária do fornecedor.

**Exceção:** se a Hook7 for substituída por outro provedor, aí o nome novo passa a valer.
