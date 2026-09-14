import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  tiers: number[];
}

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './support.component.html',
  styleUrls: ['./support.component.scss']
})
export class SupportComponent {
  /**
   * These are contribution suggestions, not live FX conversions.
   * The payment provider will become the source of truth for the final
   * charge/settlement once the production merchant account is connected.
   */
  readonly currencies: CurrencyOption[] = [
    { code: 'USD', name: 'US Dollar', symbol: '$', tiers: [2, 5, 10] },
    { code: 'EUR', name: 'Euro', symbol: '€', tiers: [2, 5, 10] },
    { code: 'GBP', name: 'British Pound', symbol: '£', tiers: [2, 5, 10] },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', tiers: [3, 7, 14] },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', tiers: [3, 8, 16] },
    { code: 'AED', name: 'UAE Dirham', symbol: 'AED ', tiers: [10, 25, 50] },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹', tiers: [199, 499, 999] }
  ];

  selectedCurrencyCode = 'USD';
  selectedAmount = 5;
  customAmount = '';

  get selectedCurrency(): CurrencyOption {
    return this.currencies.find(
      currency => currency.code === this.selectedCurrencyCode
    ) ?? this.currencies[0];
  }

  get displayAmount(): string {
    const parsed = Number(this.customAmount);
    const amount = Number.isFinite(parsed) && parsed > 0
      ? Math.round(parsed)
      : this.selectedAmount;

    return this.formatCurrency(amount);
  }

  selectCurrency(code: string): void {
    if (!this.currencies.some(currency => currency.code === code)) {
      return;
    }

    this.selectedCurrencyCode = code;
    this.selectedAmount = this.selectedCurrency.tiers[1];
    this.customAmount = '';
  }

  selectAmount(value: number): void {
    this.selectedAmount = value;
    this.customAmount = '';
  }

  selectCustom(): void {
    const parsed = Number(this.customAmount);

    if (Number.isFinite(parsed) && parsed > 0) {
      this.selectedAmount = Math.round(parsed);
    }
  }

  formatCurrency(value: number): string {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: this.selectedCurrency.code,
        maximumFractionDigits: 0
      }).format(value);
    } catch {
      return `${this.selectedCurrency.symbol}${Math.round(value)}`;
    }
  }

  currencyLabel(currency: CurrencyOption): string {
    return `${currency.code} — ${currency.name}`;
  }
}
