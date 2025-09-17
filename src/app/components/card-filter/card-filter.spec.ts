import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CardFilter } from './card-filter';

describe('CardFilter', () => {
  let component: CardFilter;
  let fixture: ComponentFixture<CardFilter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardFilter]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CardFilter);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
