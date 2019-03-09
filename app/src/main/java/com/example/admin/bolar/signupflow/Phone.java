package com.example.admin.bolar.signupflow;

import android.content.Intent;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;

import com.firebase.ui.auth.AuthUI;
import com.firebase.ui.auth.ErrorCodes;
import com.firebase.ui.auth.IdpResponse;
import com.google.firebase.auth.FirebaseAuth;

import com.example.admin.bolar.R;
import java.util.Arrays;

public class Phone extends AppCompatActivity {

    private static final int RC_SIGN_IN = 123;
    private String type;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent i = getIntent();
        type = i.getStringExtra("type");

        //Commence Phone verification
        startActivityForResult(
                AuthUI.getInstance()
                        .createSignInIntentBuilder()
                        .setAvailableProviders(Arrays.asList(new AuthUI.IdpConfig.PhoneBuilder().build()))
                        .setTheme(R.style.DarkTheme)
                        .build(),
                RC_SIGN_IN);
        AuthUI.IdpConfig phoneConfigWithDefaultNumber = new AuthUI.IdpConfig.PhoneBuilder()
                .setDefaultNumber("+123456789")
                .build();
    }


    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // RC_SIGN_IN is the request code you passed into startActivityForResult(...) when starting the sign in flow.
        if (requestCode == RC_SIGN_IN) {
            IdpResponse response = IdpResponse.fromResultIntent(data);

            // Successfully signed in
            if (resultCode == RESULT_OK) {
                //Send them to email password set up
                Intent intent = new Intent(Phone.this , EmailPassword.class);
                intent.putExtra("type", type);
                Phone.this.startActivity(intent);
                finish();
            } else {
                // Sign in failed
                if (response == null) {
                    // User pressed back button
                    //TODO: Show snack bar or something
                    return;
                }

                if (response.getError().getErrorCode() == ErrorCodes.NO_NETWORK) {
                    //TODO: Show snack bar saying no internet connection or soemthing
                    return;
                }
            }
        }
    }
}
