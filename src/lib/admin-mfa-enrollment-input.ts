export type AdminMfaEnrollmentPayload = {
  password: string;
  mfaCode?: string;
};

export function adminMfaEnrollmentPayload(form: FormData): AdminMfaEnrollmentPayload {
  const password = form.get("password");
  const mfaCode = form.get("mfaCode");

  return {
    password: typeof password === "string" ? password : "",
    ...(typeof mfaCode === "string" ? { mfaCode } : {}),
  };
}
