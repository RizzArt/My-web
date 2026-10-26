import { z } from "zod";

export const registrationSchema = z.object({
  name: z.string().trim().min(2, "Nama wajib diisi."),
  email: z.string().trim().email("Email tidak valid.").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "Password minimal 8 karakter."),
  passwordConfirmation: z.string().min(8, "Konfirmasi password minimal 8 karakter."),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: "Persetujuan wajib diisi." }) }),
}).refine((data) => data.password === data.passwordConfirmation, { path: ["passwordConfirmation"], message: "Konfirmasi password tidak cocok." });

export const adminPasswordSchema = z.string().min(12, "Password admin minimal 12 karakter.").max(200).refine((value) => {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d\s]/].filter((pattern) => pattern.test(value)).length;
  return classes >= 3;
}, "Password admin harus memiliki kombinasi huruf besar, huruf kecil, angka, atau simbol yang kuat.");

export const passwordResetSchema = z.object({
  token: z.string().min(40).max(200),
  newPassword: z.string().min(8, "Password minimal 8 karakter.").max(200),
  passwordConfirmation: z.string().min(8, "Konfirmasi password minimal 8 karakter.").max(200),
}).refine((data) => data.newPassword === data.passwordConfirmation, { path: ["passwordConfirmation"], message: "Konfirmasi password tidak cocok." });
