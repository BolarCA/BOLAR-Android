package com.example.admin.bolar.tenantmain;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.Toast;

import com.example.admin.bolar.R;
import com.stripe.android.Stripe;
import com.stripe.android.TokenCallback;
import com.stripe.android.model.Card;
import com.stripe.android.model.Token;
import com.stripe.android.view.CardInputWidget;

public class New_Application extends AppCompatActivity {

    public Button addPayment;
    public CardInputWidget mCardInputWidget;
    public Card cardToSave;
    public String testKey = "pk_test_Kg9ycE90DQhgKfxmrbv5GgYE00iFpT1qQA";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_new__application);

        addPayment = findViewById(R.id.stripe_widget_submit_button);
        mCardInputWidget = findViewById(R.id.card_input_widget);
        final Context context = this.getBaseContext();

        addPayment.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                //Stripe Step 1
                cardToSave = mCardInputWidget.getCard();
                //if we add custom properties to layout can then add to card like
                //cardToSave.setName("Customer Name");
                //cardToSave.setAddressZip("12345");
                if (cardToSave == null) {
                    //mErrorDialogHandler.showError("Invalid Card Data");
                    Toast.makeText(context, "Invalid Card Data", Toast.LENGTH_SHORT).show();
                }else{
                    getToken(cardToSave);
                }
            }
        });
    }

    //STRIPE STEP 2
    private void getToken(Card card){
        final Context context = this.getBaseContext();
        Stripe stripe = new Stripe(context, testKey);
        stripe.createToken(
                card,
                new TokenCallback() {
                    public void onSuccess(Token token) {
                        // Send token to your server
                        Toast.makeText(context, "Got Token!", Toast.LENGTH_SHORT).show();
                    }
                    public void onError(Exception error) {
                        // Show localized error message
                        Toast.makeText(context,
                                error.getLocalizedMessage(),
                                Toast.LENGTH_LONG
                        ).show();
                    }
                }
        );
    }
}
