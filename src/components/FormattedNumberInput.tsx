import React from 'react';

// Formats a number or string with thousands separators (e.g. 100000 -> "100,000")
export const formatWithSeparators = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '';
  const str = val.toString().replace(/,/g, '').replace(/\s+/g, '');
  if (str === '') return '';
  const parts = str.split('.');
  const integerPart = parts[0].replace(/\D/g, '');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (parts.length > 1) {
    return `${formattedInteger}.${parts[1].replace(/\D/g, '').slice(0, 2)}`;
  }
  return formattedInteger;
};

// Strips commas and spaces to return a clean numeric value
export const parseCleanNumber = (val: string | number | undefined | null): number => {
  if (val === undefined || val === null || val === '') return 0;
  const cleaned = val.toString().replace(/,/g, '').replace(/\s+/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
};

// Friendly Lao readable amount helper (e.g. 100,000 -> "1 ແສນ ກີບ")
export const getReadableLaoAmount = (amount: number, unit = '₭'): string => {
  if (!amount || amount <= 0) return '0 ' + unit;
  if (amount >= 1000000) {
    const millions = (amount / 1000000).toFixed(amount % 1000000 === 0 ? 0 : 2);
    return `${amount.toLocaleString()} ${unit} (~${millions} ລ້ານ)`;
  }
  if (amount >= 100000) {
    const hundredThousands = (amount / 100000).toFixed(amount % 100000 === 0 ? 0 : 1);
    return `${amount.toLocaleString()} ${unit} (~${hundredThousands} ແສນ)`;
  }
  if (amount >= 10000) {
    const tenThousands = (amount / 10000).toFixed(amount % 10000 === 0 ? 0 : 1);
    return `${amount.toLocaleString()} ${unit} (~${tenThousands} ໝື່ນ)`;
  }
  return `${amount.toLocaleString()} ${unit}`;
};

interface FormattedNumberInputProps {
  value: number | string;
  onChange: (numericValue: number, formattedString: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
  suffix?: string;
  showHelper?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  isError?: boolean;
}

export const FormattedNumberInput: React.FC<FormattedNumberInputProps> = ({
  value,
  onChange,
  placeholder = '0',
  min = 0,
  max,
  className = '',
  suffix,
  showHelper = false,
  disabled = false,
  autoFocus = false,
  id,
  isError = false,
}) => {
  const displayValue = formatWithSeparators(value);
  const numericVal = parseCleanNumber(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;
    // Allow digits and single decimal dot
    const cleanChars = inputVal.replace(/[^\d.]/g, '');
    const formatted = formatWithSeparators(cleanChars);
    const num = parseCleanNumber(formatted);
    if (max !== undefined && num > max) return;
    onChange(num, formatted);
  };

  return (
    <div className="w-full">
      <div className="relative flex items-center">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoFocus={autoFocus}
          disabled={disabled}
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
          className={`w-full font-mono font-bold tracking-wider transition-all focus:outline-none ${
            isError ? 'border-rose-500 ring-2 ring-rose-500/30' : ''
          } ${className}`}
        />
        {suffix && (
          <span className="absolute right-3 text-xs text-slate-400 font-bold pointer-events-none select-none">
            {suffix}
          </span>
        )}
      </div>
      {showHelper && numericVal > 0 && (
        <p className="text-[11px] text-amber-400/90 font-medium mt-1 pl-1">
          ✓ {getReadableLaoAmount(numericVal, suffix || '₭')}
        </p>
      )}
    </div>
  );
};
