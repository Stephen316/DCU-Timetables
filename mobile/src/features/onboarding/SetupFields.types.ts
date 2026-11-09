export type SetupPlanProps = { title: string; description: string; selected: boolean };
export type StudentNumberFieldProps = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};
