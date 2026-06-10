import vobject
import os
import glob
from datetime import date
import yaml


def get_type_param(obj, default="GERAL"):
    """Obtém os parâmetros de tipo de forma segura"""
    try:
        types = obj.type_param
        return "".join(types) if types else default
    except AttributeError:
        return default


def convert_vcf_to_markdown(input_dir="contacts", output_dir="contacts-new"):
    """
    Converte todos os arquivos VCF em um diretório para arquivos Markdown do Obsidian com frontmatter
    """
    os.makedirs(output_dir, exist_ok=True)

    for vcf_file in glob.glob(os.path.join(input_dir, "*.vcf")):
        with open(vcf_file, "r", encoding="utf-8") as f:
            vcf_content = f.read()

        for vcard in vobject.readComponents(vcf_content):
            if vcard.name != "VCARD":
                continue

            full_name = getattr(vcard, "fn", None)
            if not full_name:
                continue

            # Estrutura de dados para frontmatter
            contact_data = {
                "name": full_name.value,
                "phones": [],
                "emails": [],
                "addresses": [],
                "tags": ["contact"],
            }

            # Telefones
            if hasattr(vcard, "tel_list"):
                for tel in vcard.tel_list:
                    contact_data["phones"].append(
                        {"type": get_type_param(tel), "number": tel.value}
                    )

            # Emails
            if hasattr(vcard, "email_list"):
                for email in vcard.email_list:
                    contact_data["emails"].append(
                        {"type": get_type_param(email), "address": email.value}
                    )

            # Endereços
            if hasattr(vcard, "adr_list"):
                for adr in vcard.adr_list:
                    parts = adr.value
                    address = {
                        "type": get_type_param(adr),
                        "street": parts.street,
                        "city": parts.city,
                        "region": parts.region,
                        "code": parts.code,
                        "country": parts.country,
                    }
                    contact_data["addresses"].append(
                        {k: v for k, v in address.items() if v}
                    )

            # Organização
            if hasattr(vcard, "org"):
                contact_data["organization"] = ", ".join(vcard.org.value)

            # Aniversário
            if hasattr(vcard, "bday"):
                bday = vcard.bday.value
                if isinstance(bday, date):
                    contact_data["birthday"] = bday.isoformat()
                else:
                    contact_data["birthday"] = str(bday)

            # Notas
            if hasattr(vcard, "note"):
                contact_data["notes"] = vcard.note.value

            # Criação do conteúdo Markdown
            safe_name = "".join(
                c if c.isalnum() or c in (" ", "_", "-") else "_"
                for c in contact_data["name"]
            )
            md_file = os.path.join(output_dir, f"{safe_name.strip()}.md")

            # Frontmatter em YAML
            yaml_content = yaml.dump(
                contact_data,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )

            # Conteúdo completo do arquivo
            content = f"---\n{yaml_content}---\n\n"

            # Adiciona notas como conteúdo visível (opcional)
            if "notes" in contact_data:
                content += f"## 📝 Notas\n{contact_data['notes']}\n"

            with open(md_file, "w", encoding="utf-8") as f:
                f.write(content)


if __name__ == "__main__":
    convert_vcf_to_markdown()
