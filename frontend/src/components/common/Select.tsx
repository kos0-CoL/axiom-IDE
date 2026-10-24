import { forwardRef } from 'react';

interface SelectOption { value: string; label: string; disabled?: boolean; }

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, className, ...props }, ref) => (
    <select ref={ref} className={`w-full p-2 bg-gray-900 border border-gray-700 rounded-none text-white ${className || ''}`} {...props}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
);
Select.displayName = 'Select';
